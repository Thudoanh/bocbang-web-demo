# Speechmatics file uploads

Uploads use `STT_PROVIDER` (and the explicit `STT_FALLBACK_PROVIDER` policy).
Having `GROQ_API_KEY` for translation/summary does not select Groq Whisper for STT.
The upload worker no longer slices/re-encodes for Groq or performs local CAM++
speaker matching on Whisper segments. A Whisper segment can contain several
voices, so assigning one local speaker to that entire segment loses turn changes.

All file uploads are submitted to STT in their original format and with their
original bytes. No WAV conversion, downsampling, channel mixing or video/audio
transcoding is performed by the upload worker. This policy also applies to
retries: retained normalized WAVs from earlier processing are not used as STT
input. Those legacy storage objects remain referenced for existing playback
and cleanup flows; new uploads do not create normalized copies. Temporary
original-file downloads are cleaned up after completion or failure.

Supported formats are determined by the selected provider. A provider rejection
follows the existing error/fallback policy rather than silently converting the
file. FFprobe upload validation and FFmpeg use in other features are unchanged.

## Batch configuration

```
STT_PROVIDER=speechmatics
SPEECHMATICS_API_KEY=<existing server-side secret>
SPEECHMATICS_BATCH_MODEL=enhanced
SPEECHMATICS_BATCH_SPEAKER_SENSITIVITY=0.5
SPEECHMATICS_BATCH_PREFER_CURRENT_SPEAKER=false
```

These Batch settings are independent of the existing realtime settings.
Enhanced is now the default for file transcription, with original-file
submission and speaker diarization enabled. It is sent as `model=enhanced` with
the selected language, or `language=auto` for automatic detection. This setting
prioritizes transcription accuracy; actual processing time and accuracy must
be assessed on the user's audio. Registered voice identities are supported.
Cloud realtime microphone
keeps the Enhanced operating point; Browser STT remains Web Speech. Both are
independent of this Batch setting.
The optional `auto` model policy selects Melia 1 with `language=multi` for file transcription and speaker
diarization. Explicit VI/EN supplies strict language hints; Automatic leaves
multilingual detection enabled. Melia 1 supports Batch diarization but currently
lacks enrolled-speaker identification and confidence scores. When identities or
speaker enrollment are requested, Enhanced is used automatically, including
when Melia 1 was selected explicitly. Enhanced/Standard can still be pinned via
the environment for their accuracy/features; their Automatic mode uses native
`language=auto`. No language is hardcoded to English. Translation and summary
still use the existing separate APIs. Browser microphone and realtime model
configuration are unchanged.

Speaker labels and short replies are preserved through parsing and persistence.
Batch results do not pass through text-length speaker pruning or inertia locks.
Zero-duration punctuation is attached to the preceding words without creating
a `UU` speaker. Timed words with `UU` remain unassigned. Overlapping turns from
different labeled speakers are retained; invalid times and overlapping segments
for the same/unknown speaker are rejected before any transcript is published.

## Verification and timing

Worker logs include `media_processing_stage` and
`media_processing_transcript_ready`, with provider, job ID, segment/speaker
counts and `processing_timings_ms` for source preparation, normalization, transcription and
persistence. The same timing dictionary is retained in the job's database
payload; it is operational metadata, not a new public API field. These timings
measure worker execution, excluding browser upload time and queue waiting.
`stt_details` in the job payload holds the external job ID, selected model and
language, `submit_ms` (file upload/submission) and `wait_ms` (polling/result).
`stt_input` records the original format and submitted/original byte counts;
`native` is true and `normalization_ms` is zero under this direct-upload policy.
`speechmatics_batch_completed` also logs the submission and polling durations.
No audio, transcript text or keys are included in these added log fields.

Tests use fake SDK responses and a real SQLite worker/persistence boundary:
configured-provider selection despite a Groq key, VI/EN/auto, brief A/B/A turns,
punctuation, unknown voices, overlaps and provider errors.
Model selection, language hints, identity/enrollment fallback, byte-identical
M4A/MP4/WAV submission, ignoring legacy normalized copies and temporary-file
cleanup are also covered.

## Measured comparison on the user's recording

The following measurement compares different acoustic models; it is not a
speed-only improvement to Enhanced and does not establish equivalent accuracy.
The model default changed during the evaluation; the latest choice is Melia 1
for file uploads to prioritize turnaround time.
The measurements below describe earlier tests with different models. The
current upload policy sends original input directly with Melia 1 by default;
these measurements are not an accuracy comparison of file formats.

A single controlled run used the existing 19,610,076-byte M4A, 1,212.5 seconds,
with Melia 1, `language=multi` and speaker diarization enabled. It took 4.812 s to
submit and 5.790 s to wait for the result, 10.645 s total including local source
read/client setup. The earlier application job for that file used Expanded WAV,
Enhanced and Automatic language identification: 141.579 s worker execution,
including 139.014 s in STT, 2.064 s preparation and 0.484 s persistence.
The controlled measurement excludes browser-to-application upload time and
does not guarantee identical future latency or identical accuracy across models.
The real result was then parsed and saved in an isolated SQLite database: all
125 turns were retained, with 6 speaker labels and exact parsed text preserved.
No transcript text was printed and no existing meeting transcript was replaced.

The SDK's `transcribe()` combines submit and wait internally; changing between
that convenience call and the two calls alone does not make the acoustic model
faster. The material changes are the model, original input and equivalent options.

Rebuild the backend services before retrying a new upload. Existing transcripts
are not automatically reprocessed: upload the recording into a new meeting or
use the existing retry action where applicable. No new database migration is
required for this fix. Use the Speechmatics portal's **View config** for an exact
comparison of language/model/options; a provider name alone does not establish
equivalent settings or identical turnaround time.

The preceding regression run passed 97 tests across Speechmatics, upload, transcript,
Browser, realtime and provider adapters. Six adapter tests also fail on the
unchanged pre-fix checkout: AssemblyAI auto detection, legacy auto routing to
fallback, Groq translation batching/failure output, transcript condensation and
polish batching. These existing failures were reproduced separately before
installing this change; the corresponding adapter implementations are unchanged.

References:

- https://docs.speechmatics.com/speech-to-text/batch/quickstart
- https://docs.speechmatics.com/speech-to-text/batch/input
- https://docs.speechmatics.com/speech-to-text/batch/batch-diarization
- https://docs.speechmatics.com/speech-to-text/batch/output
- https://docs.speechmatics.com/speech-to-text/batch/language-identification
- https://docs.speechmatics.com/speech-to-text/models
