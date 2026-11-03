import asyncio
from dataclasses import replace
from uuid import uuid4

from app.providers.contracts import TranscriptionSegment
from app.services.realtime_translation import RealtimeTranslationItem, RealtimeTranslationSession


def test_in_flight_translation_is_replaced_when_the_same_row_is_extended():
    async def scenario():
        started, release = asyncio.Event(), asyncio.Event()
        calls, emitted = [], []

        class Provider:
            async def translate_segments(self, segments, source, target):
                calls.append(segments[0].text)
                if len(calls) == 1:
                    started.set()
                    await release.wait()
                return tuple(replace(s, text=f"Translated: {s.text}") for s in segments)

        async def send(event):
            emitted.append(event)

        translator = RealtimeTranslationSession(Provider(), "vi", send)
        logical_id = uuid4()
        try:
            await translator.enable("en")
            translator.add_final(RealtimeTranslationItem(logical_id, TranscriptionSegment(0, 1000, "Xin chào.")))
            await asyncio.wait_for(started.wait(), timeout=2)
            translator.add_final(RealtimeTranslationItem(logical_id, TranscriptionSegment(0, 2200, "Xin chào mọi người.")))
            release.set()
            await translator.flush(timeout_seconds=2)
            assert calls == ["Xin chào.", "Xin chào mọi người."]
            assert [e["text"] for e in emitted] == ["Translated: Xin chào mọi người."]
        finally:
            await translator.close()

    asyncio.run(scenario())
