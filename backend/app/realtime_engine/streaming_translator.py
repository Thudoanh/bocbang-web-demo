"""High-Speed Streaming & Contextual Translation Engine with True Token-by-Token Streaming.

- Decoupled asynchronous worker via asyncio.Queue (zero latency penalty on ASR).
- True SSE Token Streaming: emits translation deltas token-by-token as LLM generates.
- Speculative Live Translation: triggers mid-sentence when >= 5 words accumulate.
- Mode 2: Clause Lock & Contextual Batching (includes 5 previous sentences as context).
- Compact Delimiter Protocol:
    * Input: [ID] (SPEAKER_XX): Original text
    * Output: ID ||| Bản dịch tiếng Việt
- Automatic fallback between Groq (qwen/qwen3.8-27b) and Gemini Flash Free API.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Callable, Coroutine
import httpx

logger = logging.getLogger(__name__)


@dataclass
class TranslationTask:
    task_id: str
    speaker: str
    text: str
    is_final: bool
    context_sentences: list[str] = field(default_factory=list)
    is_speculative: bool = False
    created_at: float = field(default_factory=time.time)


class StreamingTranslator:
    """Non-blocking streaming translator with Token-by-Token LLM streaming."""

    def __init__(
        self,
        gemini_api_key: str | None = None,
        groq_api_key: str | None = None,
        on_translation_callback: Callable[[str, str, bool], Coroutine[None, None, None]] | None = None,
    ):
        self.gemini_api_key = gemini_api_key
        self.groq_api_key = groq_api_key
        self.on_callback = on_translation_callback

        self._queue: asyncio.Queue[TranslationTask] = asyncio.Queue(maxsize=100)
        self._worker_task: asyncio.Task | None = None
        self._semaphore = asyncio.Semaphore(3)
        self._client: httpx.AsyncClient | None = None

        # Auto Speaker Glossary to maintain consistent pronouns (Anh / Chị / Tôi / Bạn)
        self.speaker_glossary: dict[str, str] = {
            "SPEAKER_01": "Tôi / Anh",
            "SPEAKER_02": "Bạn / Chị",
        }

        # Caches
        self.confirmed_translations: dict[str, str] = {}
        self.latest_live_preview: str = ""
        self.last_preview_time: float = 0.0
        self.last_preview_word_count: int = 0

    async def start(self) -> None:
        """Start background translation worker."""
        if self._worker_task is None or self._worker_task.done():
            self._client = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))
            self._worker_task = asyncio.create_task(self._worker_loop(), name="streaming-translator")
            logger.info("StreamingTranslator token-streaming worker started.")

    async def stop(self) -> None:
        """Stop background translation worker."""
        if self._worker_task:
            self._worker_task.cancel()
            self._worker_task = None
        if self._client and not self._client.is_closed:
            await self._client.aclose()
            self._client = None

    def enqueue_preview(self, speaker: str, tentative_text: str) -> None:
        """Mode 1: Speculative Live Translation - triggers when >= 5 words or 800ms."""
        now = time.time()
        words = tentative_text.strip().split()
        word_count = len(words)

        time_elapsed = now - self.last_preview_time
        words_added = word_count - self.last_preview_word_count

        # Speculative translation mid-sentence: triggers when >= 4 words
        if word_count >= 4 and (time_elapsed >= 0.7 or words_added >= 3):
            self.last_preview_time = now
            self.last_preview_word_count = word_count
            task = TranslationTask(
                task_id="live_preview",
                speaker=speaker,
                text=tentative_text,
                is_final=False,
                is_speculative=True,
            )
            try:
                self._queue.put_nowait(task)
            except asyncio.QueueFull:
                pass

    def enqueue_final(self, task_id: str, speaker: str, text: str, context: list[str]) -> None:
        """Mode 2: Clause Lock - translate finalized sentence with full context."""
        task = TranslationTask(
            task_id=task_id,
            speaker=speaker,
            text=text,
            is_final=True,
            context_sentences=list(context[-5:]),
            is_speculative=False,
        )
        try:
            self._queue.put_nowait(task)
        except asyncio.QueueFull:
            logger.warning("Translation queue full, dropping task %s", task_id)

    async def _worker_loop(self) -> None:
        while True:
            try:
                task = await self._queue.get()
                # Coalesce: if next tasks in queue contain newer preview, skip stale preview
                if not task.is_final and not self._queue.empty():
                    self._queue.task_done()
                    continue

                async with self._semaphore:
                    translated = await self._translate_task_streaming(task)

                if translated:
                    if task.is_final:
                        self.confirmed_translations[task.task_id] = translated
                    else:
                        self.latest_live_preview = translated

                    if self.on_callback:
                        try:
                            await self.on_callback(task.task_id, translated, task.is_final)
                        except Exception as cb_err:
                            logger.error("Translation final callback error: %s", cb_err)

                self._queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error("Translation worker error: %s", exc)
                await asyncio.sleep(0.5)


    async def _call_instant_preview(self, text: str) -> str:
        """Tier 1: Instant zero-latency (< 60ms) preview via Google Translate endpoint."""
        if not self._client or not text.strip():
            return ""
        import urllib.parse
        encoded = urllib.parse.quote(text.strip())
        url = f"https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=auto&tl=vi&q={encoded}"
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        try:
            resp = await self._client.get(url, headers=headers, timeout=2.0)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list) and len(data) > 0:
                    if isinstance(data[0], list) and len(data[0]) > 0:
                        return str(data[0][0]).strip()
        except Exception:
            pass
        return ""

    async def _translate_task_streaming(self, task: TranslationTask) -> str:
        """Dual-Engine: Tier 1 Instant (<60ms) for live preview, Tier 2 Contextual LLM for finalized clause."""
        # Tier 1: For live preview / mid-sentence, get instant translation first (< 60ms)
        if task.is_speculative or not task.is_final:
            fast_res = await self._call_instant_preview(task.text)
            if fast_res:
                self.latest_live_preview = fast_res
                if self.on_callback:
                    await self.on_callback(task.task_id, fast_res, False)
                return fast_res

        # Tier 2: For finalized clause, run contextual LLM with 5-sentence context
        prompt = self._build_compact_prompt(task)

        # 1. Try Groq (qwen/qwen3.8-27b) with true token SSE streaming
        if self.groq_api_key:
            try:
                res = await self._call_groq_streaming(prompt, task)
                if res:
                    return res
            except Exception as exc:
                logger.warning("Groq streaming translation failed (%s), falling back to Gemini...", exc)

        # 2. Try Gemini Flash Free API
        if self.gemini_api_key:
            try:
                res = await self._call_gemini_compact(prompt, task.task_id)
                if res:
                    return res
            except Exception as exc:
                logger.error("Gemini compact translation failed: %s", exc)

        # Fallback: return raw text if both failed
        return task.text

    def _build_compact_prompt(self, task: TranslationTask) -> str:
        system_instruction = (
            "Bạn là thông dịch viên hội nghị cấp cao Việt - Anh thời gian thực.\n"
            "NHIỆM VỤ:\n"
            "1. Tự động sửa lỗi nghe nhầm âm đồng âm (homophones) của ASR dựa vào ngữ cảnh cuộc họp.\n"
            "2. Lược bỏ từ đệm vô nghĩa (ờ, à, ừm, uh, um) để câu dịch gãy gọn.\n"
            "3. Duy trì đại từ nhân xưng chuẩn mực theo vai vế (Anh / Chị / Tôi / Bạn).\n"
            "4. ĐỊNH DẠNG ĐẦU RA BẮT BUỘC: Mỗi câu trả về đúng 1 dòng: ID ||| Bản dịch tiếng Việt tự nhiên.\n"
            "Tuyệt đối KHÔNG trả về JSON, không kèm lời giải thích."
        )

        speculative_note = ""
        if task.is_speculative:
            speculative_note = (
                "\nLƯU Ý: Đây là câu người nói đang phát âm dở dang. "
                "Chỉ dịch sát nghĩa các từ hiện có, tuyệt đối không tự bịa thêm phần kết câu!\n"
            )

        context_block = ""
        if task.context_sentences:
            context_block = (
                "\n[Ngữ cảnh 5 câu trước đó]:\n"
                + "\n".join(f"- {s}" for s in task.context_sentences)
                + "\n"
            )

        speaker_role = self.speaker_glossary.get(task.speaker, "Tôi / Bạn")
        user_input = (
            f"{system_instruction}\n"
            f"{speculative_note}"
            f"{context_block}"
            f"Vai xưng hô đề xuất: {task.speaker} ({speaker_role})\n"
            f"Đầu vào cần dịch:\n"
            f"[{task.task_id}] ({task.speaker}): {task.text}"
        )
        return user_input

    async def _call_groq_streaming(self, prompt: str, task: TranslationTask) -> str:
        """Call Groq API with stream=True, parsing SSE deltas and triggering live callbacks."""
        assert self._client is not None
        headers = {
            "Authorization": f"Bearer {self.groq_api_key}",
            "Content-Type": "application/json",
        }
        body = {
            "model": "qwen/qwen3.8-27b",
            "messages": [
                {"role": "system", "content": "Return ONLY lines formatted as: ID ||| Vietnamese translation."},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.2,
            "max_tokens": 150,
            "stream": True,
        }

        full_raw = ""
        translation_text = ""
        found_delimiter = False

        async with self._client.stream(
            "POST",
            "https://api.groq.com/openai/v1/chat/completions",
            headers=headers,
            json=body,
            timeout=8.0,
        ) as resp:
            if resp.status_code != 200:
                err_text = await resp.aread()
                raise RuntimeError(f"Groq API error {resp.status_code}: {err_text.decode('utf-8', errors='ignore')}")

            async for line in resp.aiter_lines():
                if not line or not line.startswith("data: "):
                    continue
                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    break

                try:
                    chunk = json.loads(data_str)
                    delta = chunk["choices"][0].get("delta", {}).get("content", "")
                    if not delta:
                        continue

                    full_raw += delta
                    if not found_delimiter:
                        if "|||" in full_raw:
                            found_delimiter = True
                            parts = full_raw.split("|||", 1)
                            translation_text = parts[1].strip()
                    else:
                        translation_text += delta

                    # Emit incremental token update
                    if found_delimiter and translation_text and self.on_callback:
                        await self.on_callback(task.task_id, translation_text.strip(), False)

                except Exception:
                    continue

        if not translation_text:
            translation_text = self._parse_compact_delimiter(full_raw, task.task_id)

        return translation_text.strip()

    async def _call_gemini_compact(self, prompt: str, task_id: str) -> str:
        assert self._client is not None
        url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key={self.gemini_api_key}"
        body = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 150,
            },
        }
        resp = await self._client.post(url, json=body, timeout=8.0)
        if resp.status_code == 200:
            text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
            return self._parse_compact_delimiter(text, task_id)
        raise RuntimeError(f"Gemini API error {resp.status_code}: {resp.text}")

    def _parse_compact_delimiter(self, text: str, task_id: str) -> str:
        """Parse 'ID ||| Translation' from compact delimiter output."""
        lines = [line.strip() for line in text.strip().split("\n") if line.strip()]
        for line in lines:
            if "|||" in line:
                parts = line.split("|||", 1)
                return parts[1].strip()
        clean = re.sub(r"^\[.*?\]\s*", "", lines[-1] if lines else "")
        return clean.strip()
