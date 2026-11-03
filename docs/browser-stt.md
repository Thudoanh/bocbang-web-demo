# Browser STT (Web Speech)

Browser changes only microphone speech recognition. Translation, summary, polish,
storage, export and live sharing keep their existing backend/API implementations.
There is no application-managed model download and no new frontend dependency.

## Build and try with Docker Compose

1. Keep the existing API keys in the root `.env` for translation/summary. Do not
   place keys in frontend variables.
2. Run `docker compose up --build -d`. The existing `migrate` service applies
   migrations through `20261102_0019` before the API/worker start. If using a separate
   deployment, run `alembic upgrade head` with the same database configuration.
3. Open `http://localhost:5173` in desktop Chrome, sign in and create a microphone
   meeting. The sidebar selector sets the default for new meetings.
4. Choose **Browser** from the compact selector on the recording toolbar, next to
   the timer. It can be changed before the first recording only. In Browser mode,
   the VI/EN selector on the same row chooses the recognition language. Hover over
   the controls for details; the create screen has no mode selector or help block.
5. Start, allow microphone/Web Speech, speak, pause/resume, and stop. Verify that
   final text survives reload, translation appears and summary/polish/export still work.
6. Verify audio playback and live sharing from another tab. Browser timestamps are
   approximate utterance timings, not word-aligned provider measurements.

The selector also shows **Local - Sap co** as a disabled placeholder. Existing
meetings default to Cloud after migration. File uploads always use Cloud STT,
regardless of the default selected for new microphone meetings.

## Behaviour and limits

- Use HTTPS on deployed sites, or localhost for development. Plain HTTP on a LAN
  address may block microphone access. Rebuilding Docker does not change the
  capabilities or permissions of the browser running on the user's device.
- Browser support is detected before recording. Unsupported browsers display an
  error; there is no automatic fallback to paid STT.
- Web Speech may depend on the browser vendor's online service. Browser mode does
  not promise offline or entirely on-device speech recognition.
- The application does not automatically identify or separate speakers in this
  mode. Speaker assignment can still be edited manually.
- Web Speech uses an explicit language. If a new meeting requests `auto`, Browser
  normalizes it to `vi`; the user can choose English before starting/reconnecting.
- PCM audio is still sent to our backend for retained recording/playback, but it
  is not forwarded by the backend to Speechmatics, AssemblyAI or Groq STT.
- Browser previews paint directly from native recognition before waiting for the
  backend echo. Confirmed transcript rows still appear only after the final write.
- While speech continues, changed hypotheses autosave every 1.5 seconds over the
  existing authenticated socket. A separate `browser_transcript_drafts` table
  upserts one row per socket/turn; drafts never create confirmed transcript versions.
  Repeated unchanged text does not write again. Archiving an unfinished turn
  requests an immediate save. Normal audio/recognition continues during saves.
- The UI distinguishes **Đang nhận diện**, **Có bản lưu tạm · đang cập nhật**, and
  **Đã lưu tạm · đang nhận diện** using server acknowledgements, not a local timer.
  Interrupted recognition is **Nhận diện đã dừng · cần kiểm tra**, so it cannot
  look like an engine that is still processing forever. Browser rows omit speaker
  headings; Web Speech does not supply speaker diarization.
  An engine final awaiting the backend acknowledgement is **Đang lưu bản cuối**;
  it is no longer an animated active preview while the next turn is being heard.
  If the latest words have changed since the last acknowledgement, only the older
  acknowledged revision is known to be durable. The newest unacknowledged words
  can be lost on abrupt page closure or network loss.
- Drafts load with the owner bundle and live-share snapshot after reload. A real
  final atomically replaces its own saved draft with a confirmed transcript row;
  another turn or another socket's final cannot delete it. Finals can correct all
  earlier provisional words. Drafts from an interrupted older connection remain
  provisional; starting a new microphone session cannot confirm those older words.
  Viewers receive a scoped interruption event even when the owner disconnects
  before its first autosave, so an abandoned preview stops looking active.
- Translation still uses the existing API. Browser partial translation coalesces
  on saved snapshots; returned translations are applied only to matching source
  text. Summary/polish/export continue using confirmed transcript versions.
- The replaceable Web Speech results snapshot is rendered as one cumulative active
  preview, including when several interim slots exist or the snapshot shrinks.
  Longer Browser hypotheses display in short paragraphs with a mutable tail;
  paragraph layout does not claim that any individual interim word is final.
  Browser previews do not expire after three seconds of silence. A final replaces
  its own preview by turn ID; unrelated saved segments cannot remove it by time.
- To finish an utterance, Browser observes the existing 16 kHz PCM recording.
  About 1.5 seconds of low-energy audio (RMS below 0.025), or the engine's speech-end
  signal, requests `SpeechRecognition.stop()` to obtain a real final. Only actual
  microphone activity resets the PCM silence window. Late interim text revisions
  do not reset silence or postpone an already-running quiet-period watchdog.
  A stalled preview also requests a final after 8 seconds. Only the recognition turn stops:
  audio recording, the backend socket and Cloud translation continue. Recognition
  restarts automatically for the next sentence.
- The fixed RMS threshold is tuned above the observed background level (~0.019).
  Speech below that threshold can still be treated as silence; this is an energy
  heuristic rather than a trained voice detector. The 1.5-second interval is the
  time before requesting a final, not a guarantee of the engine's response latency.
- After requesting a final, wait at most 5 seconds for the engine to finish.
  If it still returns no final, retain the text as unconfirmed and restart;
  never save an interim result as if the engine had confirmed it.
- Editors automatically recover an acknowledged interrupted draft through
  `POST /meetings/{id}/browser-drafts/resolve` with `action=recover`. Once the
  recognition turn has ended, the last saved hypothesis becomes a timestamp-ordered
  STT row. A `browser_auto_commit` audit event records
  `confirmation_source=application` and `engine_confirmed=false`. This is application
  finalization of recognized text, not a claim that Google emitted `isFinal=true`.
  It does not rerun audio through a paid/cloud STT provider.
- Active recognition, native finals awaiting persistence and unsaved newer words
  are excluded from automatic recovery. Recovery retries up to three times per
  revision, without unrelated ongoing speech restarting the retry deadline.
  If storage still fails, the editor sees an error and can retry with
  **Xác nhận văn bản** or **Bỏ đoạn**. Manual confirmation remains a `user_edit`
  version. Existing confirmed text cannot be overlapped silently. Tombstones
  prevent delayed/replayed results from recreating a resolved turn.
- Restored interrupted drafts follow the same automatic recovery path. Recovered
  rows join the existing live translation backfill; matching preview translations
  can display immediately. Summary/export use the resulting transcript normally.
  Native final behavior and Cloud STT are unchanged. No migration is required.
- Pause/stop lets Web Speech return its final result (bounded wait). Unconfirmed
  text is kept as an unconfirmed draft, including on engine restart or connection
  loss. Acknowledged drafts survive reload. Text never becomes a fake engine final.
  Closing the tab interrupts recording; only acknowledged revisions are durable.
- Permission/network errors stop recognition and release the recording microphone.
  Silent recognition endings restart automatically while the session is active.

## Protocol and validation

`Meeting.stt_mode` is `cloud` or `browser`. `local` is not accepted by the API yet.
The authenticated realtime socket chooses its STT adapter from the persisted
meeting, not a client query flag. Browser text messages have the form:

```json
{
  "type": "transcript.browser",
  "result_id": "turn:0",
  "final": true,
  "revision": 4,
  "text": "Xin chao moi nguoi",
  "start_ms": 0,
  "end_ms": 1400
}
```

The backend checks edit access, message length/shape, nonnegative time intervals,
the retained audio clock and duplicate final IDs. Client text cannot attach voice
profile identity. Cloud meetings reject Browser transcript messages. All accepted
results use the same persistence, translation and spectator broadcast path as
Cloud transcripts. Local is deliberately not implemented.

Non-final messages may include `recognition_status: "unconfirmed"` when the
engine ends without confirming the preview, or `"withdrawn"` with empty `text`
when an interim snapshot retracts that preview. A non-final `save_draft: true`
requests a durable upsert. `unconfirmed` also saves immediately; `withdrawn`
removes only its own draft. `revision` is monotonic per turn; stale revisions are
ignored. Save echoes include `draft_saved_revision` and `draft_saved_at`.
Finals cannot carry either recognition status. Update API and frontend together.
New meetings default to Cloud; Local remains an unimplemented selector placeholder.

## Timing and validation

`window.browserSttTiming()` returns at most 200 local metadata records (no words,
audio or tokens): `engine.partial`, `draft.send`, `engine.stop-requested` with a
reason, `engine.final`, `backend.draft-saved`, and `backend.final`. Compare the
client monotonic `at_ms` values for the same turn. The backend phase detail contains
its queue/persistence time when available. This separates service finalization
from server saving and native preview delivery without inferring the source of a delay.

Validation includes two minutes of simulated uninterrupted speech, delayed save
acknowledgements, corrections of previously saved words, disconnect/reload,
cross-connection turn isolation, save failure rollback, ACL/share snapshots,
and upgrade/downgrade of the draft-table migration. Browser text messages are
bounded at 64,000 characters; timestamps remain approximate audio measurements.

## Integration with the latest group code

Browser mode keeps the group's upload, Cloud recognition and bidirectional
translation changes. When realtime sentence merging extends an existing logical
segment, the WebSocket final contains the complete stored sentence. Translation
also receives the complete sentence and reschedules an updated row if an older
translation is still in flight. Each Browser final removes only its own draft,
even when several native turns share the same merged logical segment.
