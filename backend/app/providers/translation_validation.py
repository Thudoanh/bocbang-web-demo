"""Reject missing/misaligned translations and substantial source-text echoes."""

import re

from app.providers.contracts import TranscriptionSegment, TranslationProviderError


def translation_source_language(language: str, text: str) -> str:
    if language in {"vi", "en"}:
        return language
    value = text.casefold()
    is_vi = bool(re.search(r"[à-ỹđ]|\b(và|của|là|được|không|tôi|em|anh|chị|mọi|người|xin|chào|cảm|ơn|với|trong|này|đó)\b", value))
    return "vi" if is_vi else "en"


def translation_is_source_echo(source: str, translated: str) -> bool:
    candidate = re.sub(r"\s+", " ", translated or "").strip().casefold()
    if not candidate or candidate == "...":
        return True
    original = re.sub(r"[^\w]", "", (source or "").casefold())
    compact = re.sub(r"[^\w]", "", candidate)
    # Numbers and short interjections can legitimately stay unchanged.
    return len(original) >= 4 and any(c.isalpha() for c in original) and original == compact


def validate_translation(
    originals: tuple[TranscriptionSegment, ...],
    translated: tuple[TranscriptionSegment, ...],
    source: str,
    target: str,
) -> tuple[TranscriptionSegment, ...]:
    if len(translated) != len(originals):
        raise TranslationProviderError("Translation segment count does not match.", code="TRANSLATION_INCOMPLETE", retryable=True)
    for original, result in zip(originals, translated, strict=True):
        if (
            not result.text.strip()
            or (original.start_ms, original.end_ms) != (result.start_ms, result.end_ms)
            or (source != target and translation_is_source_echo(original.text, result.text))
        ):
            raise TranslationProviderError("Translation is missing or repeats the source text.", code="TRANSLATION_INCOMPLETE", retryable=True)
    return translated
