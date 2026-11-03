"""Groq structured-summary adapter using its OpenAI-compatible HTTP API."""

from __future__ import annotations

import json
from typing import Any

import httpx

from app.core.config import Settings
from app.core.logging import get_logger

logger = get_logger(__name__)
from app.providers.contracts import (
    LLMCapabilities,
    LLMProviderError,
    TranscriptionSegment,
    TranslationCapabilities,
    TranslationProviderError,
)
from app.providers.transcript_polish import TranscriptPolishMixin
from app.providers.summary_validation import validate_summary

_SUMMARY_KEYS = ("overview", "key_points", "action_items", "decisions", "risks_notes")


class _GroqBase:
    """Shared Groq API client for normalized AI providers."""

    def __init__(self, api_key: str | None, model: str, api_base_url: str) -> None:
        if not api_key:
            raise ValueError("GROQ_API_KEY is required when Groq is configured as an LLM provider.")
        self._key, self._model = api_key, model
        self._api_base_url = api_base_url.rstrip("/")

    async def _generate(self, prompt: str, schema: dict[str, object] | None = None) -> dict[str, Any]:
        instruction = "You are a professional assistant. You MUST output a valid JSON object."
        response_format: dict[str, object] = {"type": "json_object"}
        if schema is not None:
            instruction += " Follow this JSON schema exactly. Keep its property names unchanged: " + json.dumps(schema, ensure_ascii=False)
            if self._model in {"openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b", "meta-models/muse-spark-open"}:
                response_format = {"type": "json_schema", "json_schema": {
                    "name": "structured_response", "strict": True, "schema": schema,
                }}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(90.0, connect=15.0)) as client:
                response = await client.post(
                    f"{self._api_base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self._key}"},
                    json={
                        "model": self._model,
                        "messages": [
                            {"role": "system", "content": instruction},
                            {"role": "user", "content": prompt},
                        ],
                        "response_format": response_format,
                        "temperature": 0.1,
                    },
                )
        except httpx.HTTPError as exc:
            raise LLMProviderError("Groq could not be reached.", code="GROQ_NETWORK_ERROR", retryable=True) from exc
        if response.is_error:
            logger.warning("groq_request_failed", extra={"model": self._model, "http_status": response.status_code})
            provider_code = None
            try:
                payload = response.json()
                error = payload.get("error", {}) if isinstance(payload, dict) else {}
                provider_code = error.get("code") if isinstance(error, dict) else None
            except (TypeError, ValueError):
                pass
            if provider_code == "json_validate_failed":
                raise LLMProviderError(
                    "Groq could not generate valid structured output.",
                    code="GROQ_JSON_VALIDATE_FAILED",
                    retryable=True,
                )
            retryable = response.status_code == 429 or response.status_code >= 500
            raise LLMProviderError(
                "Groq rate limit was reached. Please try again shortly."
                if response.status_code == 429
                else "Groq rejected the request.",
                code="GROQ_RATE_LIMITED" if response.status_code == 429 else "GROQ_HTTP_ERROR",
                retryable=retryable,
            )
        try:
            payload = response.json()
            text = payload["choices"][0]["message"]["content"]
            result = json.loads(text)
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
            raise LLMProviderError("Groq returned invalid structured output.", code="GROQ_RESULT_INVALID", retryable=True) from exc
        if not isinstance(result, dict):
            raise LLMProviderError("Groq returned invalid structured output.", code="GROQ_RESULT_INVALID", retryable=True)
        return result


class GroqSummaryProvider(TranscriptPolishMixin, _GroqBase):
    """Generate normalized meeting summaries through Groq."""

    def capabilities(self) -> LLMCapabilities:
        return LLMCapabilities(structured_output=True, max_context_tokens=131_072)

    async def generate_summary(
        self,
        transcript: str,
        user_prompt: str | None,
        output_language: str,
        template: str | None = None,
    ) -> dict[str, object]:
        language_name = {"vi": "Vietnamese", "en": "English"}[output_language]
        if template:
            schema: dict[str, object] = {
                "type": "object",
                "properties": {
                    "overview": {"type": "string"},
                    **{key: {"type": "array", "items": {"type": "string"}} for key in _SUMMARY_KEYS[1:]},
                },
                "required": list(_SUMMARY_KEYS),
                "additionalProperties": False,
            }
            focus = {
                "general": "Cover the overall discussion and the most important outcomes.",
                "briefing": "Emphasize concise updates, blockers, owners, and next actions.",
                "voting": "Emphasize motions, voting results, decisions, and dissenting views.",
            }.get(template, "Cover the most important meeting outcomes.")
            prompt = (
                f"Create a faithful {template} meeting summary. {focus} "
                "Use only facts present in the transcript and never invent details. "
                f"Write every human-readable value in {language_name}. Keep the JSON property names unchanged. "
                f"Return JSON only.\n\nTranscript:\n{transcript}"
            )
        else:
            if not user_prompt:
                raise LLMProviderError(
                    "A custom summary prompt is required.", retryable=False
                )
            schema = {
                "type": "object",
                "properties": {
                    "content": {"type": "string"},
                },
                "required": ["content"],
                "additionalProperties": False,
            }
            prompt = (
                "Create a faithful meeting summary that follows the user's requested structure and length. "
                "Place the entire result in the JSON content string. The content may contain plain-text "
                "headings, paragraphs, numbered lists, or bullet lists when the user asks for them. "
                "Use only facts present in the transcript and never invent details. "
                f"Write every human-readable value in {language_name}. Return JSON only. "
                f"\n\nUser request:\n{user_prompt}\n\nTranscript:\n{transcript}"
            )
        return validate_summary(await self._generate(prompt, schema), template)


class GroqTranslationProvider(_GroqBase):
    """Translate transcript segments through Groq while preserving alignment."""

    def capabilities(self) -> TranslationCapabilities:
        return TranslationCapabilities(frozenset({("vi", "en"), ("en", "vi")}))

    async def translate_segments(
        self, segments: tuple[TranscriptionSegment, ...], source: str, target: str
    ) -> tuple[TranscriptionSegment, ...]:
        if not segments:
            return ()

        batch_size = 15
        all_translated: list[TranscriptionSegment] = []

        for i in range(0, len(segments), batch_size):
            batch = segments[i : i + batch_size]
            prompt = (
                f"Translate the following transcript segments from {source} to {target}.\n"
                f"Return a JSON object containing a \"translations\" list with exactly {len(batch)} translated strings in the exact same order.\n"
                f"Example format: {{\"translations\": [\"...\", \"...\"]}}\n\n"
                f"Segments to translate:\n" + json.dumps([item.text for item in batch], ensure_ascii=False)
            )
            batch_texts: list[str] = []
            try:
                result = await self._generate(prompt)
                raw_texts = result.get("translations")
                if (
                    not isinstance(raw_texts, list)
                    or len(raw_texts) != len(batch)
                    or any(not isinstance(t, str) or not t.strip() for t in raw_texts)
                ):
                    raise TranslationProviderError("Groq returned incomplete translations.", code="TRANSLATION_INCOMPLETE", retryable=True)
                batch_texts = [t.strip() for t in raw_texts]
            except LLMProviderError as exc:
                raise TranslationProviderError(str(exc), code=exc.code, retryable=exc.retryable) from exc
            except TranslationProviderError:
                raise
            except Exception as exc:
                raise TranslationProviderError("Groq translation failed.", retryable=True) from exc

            for j, item in enumerate(batch):
                translated_text = batch_texts[j]
                all_translated.append(
                    TranscriptionSegment(
                        start_ms=item.start_ms,
                        end_ms=item.end_ms,
                        text=translated_text,
                        speaker_label=item.speaker_label,
                        confidence=item.confidence,
                    )
                )

        return tuple(all_translated)


def build_groq_summary_provider(settings: Settings) -> GroqSummaryProvider:
    return GroqSummaryProvider(settings.groq_api_key, settings.groq_model, settings.groq_api_base_url)


def build_groq_translation_provider(settings: Settings) -> GroqTranslationProvider:
    return GroqTranslationProvider(settings.groq_api_key, settings.groq_model, settings.groq_api_base_url)
