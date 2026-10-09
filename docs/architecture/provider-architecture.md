# Provider architecture

_Đối chiếu `backend/app/providers/`: 2026-10-08._

## Contracts và registry

Domain services dùng normalized contracts trong `contracts.py`; SDK/HTTP vendor
nằm trong adapter modules. STT, translation và LLM có registry/factory backend,
storage/email có factory riêng. Provider credentials không xuất hiện trong
frontend bundle hay WebSocket events.

| Contract | API chính |
| --- | --- |
| `STTProvider` | `capabilities()`, `transcribe_file(source, language=None, known_speakers=())`, `open_stream(options)`. |
| `STTStream` | `send_audio/pause/resume/close` trả tuple `StreamingEvent`; metadata `provider_name`, `speaker_identification_available`, `fallback_active`. |
| `SpeakerEnrollmentProvider` | `enroll_speaker(source, language="vi")` trả `SpeakerEnrollment`. |
| `TranslationProvider` | `capabilities()`, `translate_segments(segments, source, target)`. |
| `LLMProvider` | `capabilities()`, `generate_summary(transcript, template, output_language)`. |

STT capability gồm batch, streaming, diarization, timestamps, confidence,
supported languages và multilingual auto-detect. Translation khai báo cặp
ngôn ngữ; LLM khai báo structured output và optional context limit.
`GET /api/v1/capabilities` chuyển các field này thành public configuration;
không phải phép thử kết nối/provider health.

Normalized `TranscriptionSegment` có start/end ms, text, speaker label,
confidence và optional speaker name/voice profile/identified flag.
`TranscriptionResult` có language, segments, provider name và fallback flag.
`StreamingOptions` nhận language, diarization, audio format và known speakers.

## Adapters hiện có

| Chức năng | Adapter / cấu hình |
| --- | --- |
| STT primary trong env mẫu | Speechmatics batch/realtime, `STT_PROVIDER=speechmatics`, `SPEECHMATICS_API_KEY`. |
| STT fallback hoặc primary tùy chọn | AssemblyAI, `STT_FALLBACK_PROVIDER=assemblyai` hoặc `STT_PROVIDER=assemblyai`, `STT_API_KEY`. |
| Enrollment | Speechmatics voice, được tạo khi có Speechmatics key. |
| Translation | Gemini hoặc Groq, VI ↔ EN, segment-aligned output. |
| Summary | Gemini hoặc Groq; `general/briefing/voting`, output VI/EN. |
| Storage | Local filesystem và private S3-compatible bucket. |
| Email | SMTP cho delivery thật; console cho dev in OTP ra stdout, không gửi mail. Chưa có email API adapter. |

Settings mặc định không chọn STT/translation/LLM provider; lựa chọn trong
`.env.example` là cấu hình demo. Gemini model default trong code là
`gemini-2.5-flash`; AssemblyAI batch `universal-3-pro`, streaming
`universal-3-6-pro`/`balanced`; Groq `openai/gpt-oss-20b`. Đây là defaults
của repository, không phải danh sách model từ vendor. Xem
[cấu hình](../deployment/environment.md).

## Fallback

`FallbackSTTProvider` giữ capabilities của primary. Secondary chỉ được thử khi
primary ném `STTProviderError(retryable=True)` lúc mở stream hoặc transcribe
batch. Không fallback cho lỗi non-retryable, không chuyển giữa stream đã mở.
AssemblyAI nhận known speakers rỗng vì không hiểu Speechmatics identifiers.
Result/stream gắn `fallback_active` để UI báo thiếu nhận diện tên.

Translation/LLM fallback cấu hình qua `TRANSLATION_FALLBACK_PROVIDER` và
`LLM_FALLBACK_PROVIDER`; Groq được gọi sau lỗi provider primary, không chạy song
song. Lỗi chuẩn hóa có stable code/retryable; worker lưu failed/retry state.

## Enrollment và known speakers

FFmpeg chuẩn hóa sample thành mono PCM16 WAV/16 kHz; sample bắt buộc 10–25 giây
và một người nói. Profile lưu tối đa ba Speechmatics identifiers, provider và
sample count; REST schema không trả identifiers hay audio storage path.
Audio mẫu được xử lý qua temporary files, không giữ durable sample recording.

Candidates gồm guest profiles thuộc meeting và personal profiles của owner/
members. Tối đa 50 profiles có identifiers; mỗi phiên phân bổ tối đa 50
identifiers round-robin. Label opaque `VP_<UUID hex>` được map về profile/name.
Người chưa nhận diện giữ nhãn generic. Migration `0012` bỏ dữ liệu MFCC cũ,
không còn local MFCC matching.

## Realtime và versioning

Browser gửi PCM16 mono 16 kHz bằng AudioWorklet. Speechmatics/AssemblyAI stream
được mở server-side; AssemblyAI pin language của meeting và diarization option.
Partial chỉ socket, final persisted; service scope speaker label theo connection.

`StreamingEvent` là union `StreamingTranscriptionEvent` và
`StreamingSpeakerRevision(turn_order, speaker_label)`. Correction áp dụng theo
thứ tự đến, tạo revision history, không tạo transcript text mới; manual speaker
assignment/unassignment và split/merge/delete được bảo vệ. AssemblyAI Turn với
speaker chưa gán map null; nhiều speaker trong một Turn không tự tách per-word.
Reconnect tạo upstream mới, không hứa resume identity của generic speaker.

Dịch realtime dùng cùng translation contract nhưng queue tạm theo socket,
không lưu translation tables. Saved translation/summary/export dùng worker
và immutable transcript input.

## Thêm provider

Implement contract và capability trung thực; normalize response; đăng ký factory
và config backend; bổ sung contract tests, integration verification khi có
credentials. Giữ vendor SDK ngoài service, không thay public API nếu contract
hiện tại đủ diễn đạt chức năng. Không fake capability hoặc provider result.
