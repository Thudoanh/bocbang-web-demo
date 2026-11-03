"""Database Backfill Script: Cleans and Merges Fragmented STT Segments in MySQL.

Applies the Smart Sentence Merger and Speaker Stabilization Refiner to all recent meetings
in the MySQL database, stripping false periods, removing spurious ghost speakers, and
regenerating accurate translations.
"""

from __future__ import annotations

import asyncio
from decimal import Decimal
import logging
from uuid import UUID

from sqlalchemy import delete, select

from app.core.config import Settings
from app.db.session import Database
from app.models.meeting import Meeting
from app.models.transcript import CurrentSegment, SegmentVersion, Speaker, Transcript, TranscriptVersion
from app.models.translation import Translation, TranslationSegment
from app.providers.contracts import TranscriptionSegment
from app.providers.google_translate import GoogleTranslateProvider
from app.services.sentence_merger import merge_fragmented_segments

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def backfill_meeting(session, meeting: Meeting, gt_provider: GoogleTranslateProvider) -> bool:
    transcript = await session.scalar(
        select(Transcript).where(Transcript.meeting_id == meeting.id)
    )
    if not transcript:
        return False

    current_segs = list(
        await session.scalars(
            select(CurrentSegment)
            .where(CurrentSegment.transcript_id == transcript.id)
            .order_by(CurrentSegment.position, CurrentSegment.start_ms)
        )
    )
    if not current_segs:
        return False

    # Map current segments to TranscriptionSegments
    speaker_cache: dict[UUID, Speaker] = {}
    converted: list[TranscriptionSegment] = []
    for cs in current_segs:
        spk_name = None
        if cs.speaker_id:
            if cs.speaker_id not in speaker_cache:
                spk = await session.get(Speaker, cs.speaker_id)
                if spk:
                    speaker_cache[cs.speaker_id] = spk
            spk_obj = speaker_cache.get(cs.speaker_id)
            if spk_obj:
                spk_name = spk_obj.name

        converted.append(
            TranscriptionSegment(
                start_ms=cs.start_ms,
                end_ms=cs.end_ms,
                text=cs.text,
                speaker_label=spk_name or "speaker_1",
                confidence=cs.confidence,
                speaker_name=spk_name,
            )
        )

    merged = merge_fragmented_segments(converted)
    if len(merged) == len(current_segs) and all(
        m.text == c.text for m, c in zip(merged, current_segs)
    ):
        logger.info("Meeting %s (%s) already clean (%d segments).", meeting.id, meeting.title, len(merged))
        return False

    logger.info(
        "Merging meeting %s (%s): %d segments -> %d segments",
        meeting.id,
        meeting.title,
        len(current_segs),
        len(merged),
    )

    # Resolve speaker IDs for merged segments
    spk_id_by_name: dict[str, UUID] = {
        spk.name: spk.id for spk in speaker_cache.values() if spk.name
    }
    first_spk_id = current_segs[0].speaker_id

    # Wipe and replace CurrentSegments
    await session.execute(
        delete(CurrentSegment).where(CurrentSegment.transcript_id == transcript.id)
    )
    await session.flush()

    new_currents: list[CurrentSegment] = []
    for idx, m in enumerate(merged, start=1):
        spk_id = spk_id_by_name.get(m.speaker_label or "", first_spk_id)
        cs = CurrentSegment(
            transcript_id=transcript.id,
            speaker_id=spk_id,
            position=Decimal(idx * 1024),
            start_ms=m.start_ms,
            end_ms=m.end_ms,
            text=m.text,
            original_stt_text=m.text,
            confidence=m.confidence,
        )
        session.add(cs)
        new_currents.append(cs)

    await session.flush()

    # Also update latest TranscriptVersion if exists
    if meeting.current_transcript_version_id:
        version = await session.get(TranscriptVersion, meeting.current_transcript_version_id)
        if version:
            await session.execute(
                delete(SegmentVersion).where(SegmentVersion.transcript_version_id == version.id)
            )
            await session.flush()
            for idx, cs in enumerate(new_currents, start=1):
                session.add(
                    SegmentVersion(
                        transcript_version_id=version.id,
                        logical_segment_id=cs.logical_segment_id,
                        speaker_id=cs.speaker_id,
                        sequence=idx,
                        start_ms=cs.start_ms,
                        end_ms=cs.end_ms,
                        text=cs.text,
                        original_stt_text=cs.text,
                        confidence=cs.confidence,
                    )
                )
            await session.flush()

    # Re-translate cleaned sentences
    import re

    async def _trans_one(cs: CurrentSegment) -> str:
        t = cs.text.strip()
        if not t:
            return ""
        is_vi = any(c in t.casefold() for c in "ăâđêôơưàáảãạằắẳẵặầấẩẫậèéẻẽẹềếểễệìíỉĩịòóỏõọồốổỗộờớởỡợùúủũụừứửữựỳýỷỹỵ")
        if not is_vi:
            is_vi = bool(re.search(r"\b(và|của|là|được|không|tôi|em|anh|chị|mọi|người|xin|chào|cảm|ơn|có|thì|với|trong|này|đó|cho|đã|sẽ|rồi|nhé|gì|nào|sao|đây)\b", t.casefold()))
        tgt = "en" if is_vi else "vi"
        try:
            res = await gt_provider.translate_segments(
                (TranscriptionSegment(cs.start_ms, cs.end_ms, t),),
                source="auto", target=tgt
            )
            return res[0].text.strip() if res else t
        except Exception:
            return t

    translated_texts = await asyncio.gather(*[_trans_one(cs) for cs in new_currents])

    # Update or create translation records
    translations = list(
        await session.scalars(
            select(Translation).where(Translation.meeting_id == meeting.id)
        )
    )
    for tr in translations:
        await session.execute(
            delete(TranslationSegment).where(TranslationSegment.translation_id == tr.id)
        )
        await session.flush()
        for idx, (cs, tr_text) in enumerate(zip(new_currents, translated_texts), start=1):
            session.add(
                TranslationSegment(
                    translation_id=tr.id,
                    logical_segment_id=cs.logical_segment_id,
                    sequence=idx,
                    text=tr_text,
                )
            )

    await session.commit()
    logger.info("Successfully cleaned and backfilled meeting %s (%s)", meeting.id, meeting.title)
    return True


async def main():
    settings = Settings()
    db = Database(settings.database_url)
    gt_provider = GoogleTranslateProvider(timeout_seconds=6.0)

    async with db.session() as session:
        meetings = list(
            await session.scalars(
                select(Meeting).order_by(Meeting.created_at.desc()).limit(20)
            )
        )
        for m in meetings:
            try:
                await backfill_meeting(session, m, gt_provider)
            except Exception as exc:
                logger.error("Failed to backfill meeting %s: %s", m.id, exc)


if __name__ == "__main__":
    asyncio.run(main())
