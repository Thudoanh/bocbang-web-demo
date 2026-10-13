"""Replay mono 16 kHz PCM WAV in real time and measure Speechmatics output.

No transcript text or credentials are printed. Use the same WAV for comparisons.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import statistics
import sys
import wave
from array import array
from pathlib import Path
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import Settings  # noqa: E402
from app.providers.contracts import StreamingOptions, StreamingTranscriptionEvent  # noqa: E402
from app.providers.speechmatics import SpeechmaticsProvider  # noqa: E402


async def measure(args: argparse.Namespace) -> dict[str, object]:
    with wave.open(str(args.wav), "rb") as source:
        if source.getsampwidth() != 2 or source.getcomptype() != "NONE":
            raise ValueError("Expected uncompressed PCM16 WAV.")
        channels, rate = source.getnchannels(), source.getframerate()
        samples = array("h", source.readframes(source.getnframes()))
    if sys.byteorder != "little":
        samples.byteswap()
    mono = [sum(samples[index:index + channels]) / channels
            for index in range(0, len(samples), channels)]
    resampled = array("h")
    for index in range(round(len(mono) * 16000 / rate)):
        position = index * rate / 16000
        left = min(int(position), len(mono) - 1)
        right = min(left + 1, len(mono) - 1)
        fraction = position - left
        resampled.append(round(mono[left] * (1 - fraction) + mono[right] * fraction))
    if sys.byteorder != "little":
        resampled.byteswap()
    audio = resampled.tobytes()
    if not audio:
        raise ValueError("WAV is empty.")
    if args.scenario == "short":
        audio = audio[:32000 * 3]
    elif args.scenario == "paused":
        midpoint = (len(audio) // 4) * 2
        audio = audio[:midpoint] + bytes(32000) + audio[midpoint:]
    settings = Settings(
        _env_file=args.env_file,
        speechmatics_max_delay_seconds=args.max_delay,
        speechmatics_finalization_delay_seconds=args.debounce,
    )
    stream = await SpeechmaticsProvider(settings).open_stream(StreamingOptions(args.language, True))
    samples: list[dict[str, object]] = []
    started = perf_counter()

    def capture(events):
        for event in events:
            if not isinstance(event, StreamingTranscriptionEvent):
                continue
            elapsed_ms = (perf_counter() - started) * 1000
            samples.append({
                "event_id": event.event_id,
                "type": event.type,
                "elapsed_ms": round(elapsed_ms, 2),
                "audio_end_ms": event.segment.end_ms,
                "audio_lag_ms": round(elapsed_ms - event.segment.end_ms, 2),
                "queue_ms": round((perf_counter() - event.captured_at) * 1000, 2),
                "word_count": len(event.segment.text.split()),
            })

    async def reader():
        while True:
            capture(await stream.receive_events())

    receiver = asyncio.create_task(reader())
    try:
        # AudioWorklet uses 100 ms / 3200 byte chunks, including silence.
        padded = audio + bytes(round(args.trailing_silence * 16000) * 2)
        for offset in range(0, len(padded), 3200):
            if receiver.done():
                receiver.result()
            await asyncio.sleep(max(0, started + (offset + 3200) / 32000 - perf_counter()))
            capture(await stream.send_audio(padded[offset:offset + 3200]))
    finally:
        receiver.cancel()
        await asyncio.gather(receiver, return_exceptions=True)
        capture(await stream.close())
    partials = [sample for sample in samples if sample["type"] == "partial"]
    lags = sorted(float(sample["audio_lag_ms"]) for sample in partials)
    result = {
        "wav": args.wav.name,
        "scenario": args.scenario,
        "audio_duration_ms": round(len(audio) / 32),
        "max_delay_seconds": args.max_delay,
        "debounce_seconds": args.debounce,
        "partial_count": len(partials),
        "final_count": sum(sample["type"] == "final" for sample in samples),
        "first_partial_ms": partials[0]["elapsed_ms"] if partials else None,
        "partial_before_audio_end": any(
            float(sample["elapsed_ms"]) < len(audio) / 32 for sample in partials
        ),
        "partial_audio_lag_p50_ms": round(statistics.median(lags), 2) if lags else None,
        "partial_audio_lag_p95_ms": (
            lags[min(len(lags) - 1, round((len(lags) - 1) * .95))] if lags else None
        ),
        "events": samples,
    }
    if args.output:
        args.output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    return {key: value for key, value in result.items() if key != "events"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("wav", type=Path)
    parser.add_argument("--env-file", type=Path, default=Path("../.env"))
    parser.add_argument("--language", default="vi")
    parser.add_argument("--scenario", choices=("full", "short", "paused"), default="full")
    parser.add_argument("--max-delay", type=float, default=1.5)
    parser.add_argument("--debounce", type=float, default=.75)
    parser.add_argument("--trailing-silence", type=float, default=4)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.trailing_silence < 0:
        parser.error("--trailing-silence must be nonnegative")
    print(json.dumps(asyncio.run(measure(args)), indent=2))


if __name__ == "__main__":
    main()
