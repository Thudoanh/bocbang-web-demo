# Realtime partial validation

The browser sends PCM16 mono 16 kHz audio in 100 ms chunks. Speechmatics output is
now received independently while the endpoint waits for audio/control messages.
Event emission and database writes remain serialized. A pending reader is cancelled
and awaited before pause, stop, and disconnect cleanup, so it cannot consume the
final flush. Legacy injected adapters without `receive_events()` retain their old behavior.
Final flush and database session cleanup are shielded from AnyIO cancellation.

## Browser measurement

In DevTools Console, enable diagnostics before recording:

```js
localStorage.setItem("sttDiagnostics", "1")
```

Enable Debug/Verbose console messages. Each rendered interim/final row emits `STT timing`
with `event_id`, `stream_segment_id`, `backend_queue_ms`, `browser_render_ms`, and raw
stream audio end time. Once rows have rendered:

```js
console.table(window.sttTimingSamples())
copy(JSON.stringify(window.sttTimingSamples(), null, 2))
```

Only the latest 200 rendered samples are retained. Turn diagnostics off with:

```js
localStorage.removeItem("sttDiagnostics")
```

Set `LOG_LEVEL=DEBUG` and restart the backend to enable these logs.
Backend DEBUG logs in `app.providers.speechmatics` record normalized partial capture;
`app.api.v1.routes.realtime` records the same event ID immediately before sending.
`backend_queue_ms` uses one backend monotonic clock; final events include the turn
debounce and persistence time. `browser_render_ms` uses the browser monotonic clock
from message receipt to the frame callback following React commit. Neither metric
measures network transit between hosts. No transcript text is included in timing logs.
Partials replaced before a frame is rendered do not produce render samples.

## Repeatable provider measurement

Prepare three PCM16 WAVs (the script downmixes/resamples to mono 16 kHz):
a 10–15 second continuous Vietnamese sentence,
a short sentence, and speech containing 0.5–1 second pauses. Use the same files for
each configuration; use a reference transcription to compare recognition errors and
speaker boundaries manually. From `backend`:

```powershell
.\.venv\Scripts\python.exe scripts/measure_partial.py long.wav --max-delay 2 --debounce 3 --output baseline-long.json
.\.venv\Scripts\python.exe scripts/measure_partial.py long.wav --max-delay 1.5 --debounce .75 --output faster-long.json
```

Repeat for short/paused speech. The script sends real audio to Speechmatics using the
configured account, prints counts and latency statistics, and optionally saves timing
events without transcript text. `audio_lag_ms` is elapsed replay time minus the event's
audio end timestamp; it includes provider/network processing and is not word-level
recognition latency. `partial_before_audio_end` proves output arrived before the WAV
ended, but does not prove it arrived before speech ended if the file has trailing silence.

For controlled variations of one fixture, `--scenario short` takes its first 3 seconds;
`--scenario paused` inserts 1 second of silence at the midpoint. These do not replace
properly recorded Vietnamese sentences with known reference text.

Current starting defaults: `SPEECHMATICS_MAX_DELAY_SECONDS=1.5`,
`SPEECHMATICS_FINALIZATION_DELAY_SECONDS=0.75`. The silence trigger remains 1 second
and must be below max delay. To test max delay 1 second, also reduce the silence trigger
in the env file, for example to 0.7 seconds. Restore 2/3 for the prior latency settings.

## Acceptance checks

- While speaking continuously, the transcript shows successive partial snapshots.
- Recognition corrections replace words instead of duplicating them.
- A delayed old final preserves a newer partial; covered fragments become one final row.
- Final text remains visible until the persisted transcript fetch finishes.
- Pause delivers late output without requiring new audio; stop flushes the final words.
- Reconnecting clears only obsolete interim rows and uses a new session namespace.
- Known speaker names and final-only translation continue to work.
- Compare Vietnamese errors and turn fragmentation before treating faster defaults as tuned.

Automated regression tests use simulated provider events. Real mic latency and Vietnamese
accuracy require the above browser/audio checks; passing mocks does not establish them.

## Recorded provider checks — 2026-10-09

The existing `speechmatics-test/realtime-audio-test.wav` contains English speech.
All runs used the live Speechmatics service, paced 100 ms chunks, and no fallback.
Timing JSON files in `speechmatics-test/partial-*-measurement.json` contain no text.

| Input / configuration | First partial (ms) | Partials | Finals | Partial before WAV ended |
| --- | ---: | ---: | ---: | --- |
| Full 13.137 s, max delay 2 / debounce 3 | 1107.20 | 32 | 3 | Yes |
| Full 13.137 s, max delay 1.5 / debounce .75 | 1097.99 | 34 | 1 | Yes |
| First 3 s, max delay 1.5 / debounce .75 | 1141.26 | 13 | 1 | Yes |
| With 1 s inserted pause, max delay 1.5 / debounce .75 | 1110.86 | 35 | 1 | Yes |

This is one run per case, not a statistically controlled benchmark. The older settings
also delivered early partials; these measurements do not establish a material improvement
in provider time to first partial. Final counts varied and require speaker/segmentation
review with reference audio. Browser display timing and Vietnamese accuracy have not
been measured by these provider-only checks.

Verification: 49 backend tests across `test_speechmatics_provider.py`, `test_realtime.py`,
`test_realtime_speakers.py`, and `test_provider_adapters.py` passed (the changed suites
were rerun after their final edits). Five frontend reducer tests passed with
`node --test tests/liveTranscript.test.ts` on Node 24. `npm run build` passed.
The changed backend code passed Ruff; pre-existing long-line/style violations in
`contracts.py` and `assemblyai.py` were left intact, with F/I checks passing there.
