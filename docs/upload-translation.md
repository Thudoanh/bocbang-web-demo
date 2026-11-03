# Upload translation

After batch STT, the upload worker commits a separate `translation` job with the
transcript version and VI/EN language pair. The upload/STT job completes without
waiting for translation. Redis delivers the translation job to `AIJobDispatcher`;
the existing reconciler republishes queued jobs if initial delivery fails.
No untracked `asyncio.create_task` outlives the STT worker's event loop.

The meeting page's automatic translation request reuses pending work for the same
meeting, transcript version and language pair. Translation failures use the
existing retry/error lifecycle and do not turn a successful STT job into a failure.
No database migration or STT configuration change is needed.

## Provider behavior

- `TRANSLATION_PROVIDER` selects the primary provider.
- `TRANSLATION_FALLBACK_PROVIDER`, if different from the primary and configured
  with credentials, is tried next. Missing credentials for this optional provider
  are logged; Google Translate remains the last fallback.
- Empty, misaligned and substantial source-echo results are failures, including
  when the HTTP/API call itself succeeded. A failed Groq batch raises an error
  instead of filling missing translations with the source text.
- A complete valid result is required before translation rows are persisted.
  Numeric-only text and very short interjections can legitimately be unchanged.
- Failure logs record provider class, error code and segment count, without
  transcript text or credentials.

The manual instant-translation endpoint honors the requested target language and
returns empty text on failure. It does not claim the original text is translated.
Completed uploads use the durable job rather than racing an automatic instant
request against the worker.

## Existing bad translations

The meeting page ignores substantial source echoes both in database results and
in localStorage. Missing translations can then trigger the existing automatic
translation flow again. Old records are not deleted. Confirm the new translation
loads after refreshing the page; the source transcript remains unchanged.

## Deployment and verification

Deploy API, worker, reconciler and frontend together. Run the existing queue and
reconciler services. Verify with a Vietnamese upload that:

1. The original transcript becomes available before translation finishes.
2. Missing rows show a pending/error state rather than copies of the source.
3. The final translation is English, survives refresh and preserves row IDs.
4. A failed primary translator activates the configured fallback.

Tests use fake providers and HTTP mocks, including separate worker event loops,
broker failure, invalid successful responses, retries and legacy source echoes.
No paid AI request is required by these regression tests.
