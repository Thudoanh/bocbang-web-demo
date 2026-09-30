# Open Provider Architecture

## Decisions đã chốt

-   **Phân quyền:** không có global Admin trong web demo. Mỗi meeting có
    `owner` và cộng tác viên theo ACL `read | comment | edit`. Đây là
    phân quyền theo tài nguyên, cần thiết vì hệ thống có chia sẻ/cộng
    tác.
-   **Đăng ký:** email + password và bắt buộc xác minh email bằng OTP
    trước khi kích hoạt đầy đủ.
-   **Google Login:** Google OAuth thật.
-   **Upload demo:** tối đa **500 MB/file** và **2 giờ/file**, cấu hình
    bằng environment. Hỗ trợ đầu vào phổ biến:
    `mp3, wav, m4a, aac, flac, ogg, opus, webm, mp4, mov, mkv, avi, mpeg/mpg`.
    Backend dùng **FFmpeg** để probe/normalize audio trước STT, vì
    provider không nhất thiết nhận mọi container/codec.
-   **STT:** kiến trúc provider mở. Demo phải có ít nhất một adapter
    thật; provider được chọn qua config. Capability model quyết định
    `batch`, `streaming`, `diarization`, `languages`, `timestamps`,
    `confidence`.
-   **Ngôn ngữ STT:** demo bảo đảm Việt + Anh; kiến trúc hỗ trợ mở rộng
    multilingual theo capability provider.
-   **Diarization:** bắt buộc trong demo nếu provider được chọn hỗ trợ;
    UI hiển thị Speaker 1, Speaker 2...
-   **Translation:** provider mở; demo bảo đảm VI ↔ EN; mở rộng
    multilingual theo provider.
-   **LLM:** provider mở; không hard-code vendor/model vào business
    service.
-   **Summary:** `general`, `briefing`, `voting`.
-   **Export:** PDF, DOCX, TXT, SRT, VTT, JSON.
-   **Share:** `read`, `comment`, `edit`.
-   **Retention:** không tự xóa audio theo thời gian trong demo; user có
    thể xóa audio hoặc meeting.
-   **Delete meeting:** xóa toàn bộ dữ liệu phụ thuộc và object storage
    liên quan.
-   **Versioning:** giữ lịch sử transcript và summary. Không overwrite
    version cũ.
-   **Xin ý kiến:** loại khỏi scope.
-   **Deploy demo:** ưu tiên **Render** cho frontend static, FastAPI web
    service, background worker, PostgreSQL và Redis-compatible Key
    Value; object storage dùng S3-compatible managed storage bên ngoài.
    Kiến trúc không phụ thuộc Render.
-   **Frontend:** không tiếp tục maintain bundle `script.js`; agent dựng
    lại source React/TypeScript maintainable từ UI hiện tại.

## 1. Khả thi không?

Có. Provider mở là kiến trúc phù hợp cho dự án này, nhưng **không thể
giả định mọi provider có cùng capability**. Vì vậy cần
`Provider Interface + Capability Discovery + Normalized Domain Model`.

## 2. STT contract

``` python
class STTCapabilities:
    batch: bool
    streaming: bool
    diarization: bool
    timestamps: bool
    confidence: bool
    supported_languages: set[str]
    multilingual_auto_detect: bool

class STTProvider:
    def capabilities(self) -> STTCapabilities: ...
    async def transcribe_file(self, media, options): ...
    async def open_stream(self, options): ...

class STTStream:
    async def send_audio(self, chunk: bytes) -> tuple[StreamingTranscriptionEvent, ...]: ...
    async def pause(self) -> tuple[StreamingTranscriptionEvent, ...]: ...
    async def resume(self) -> tuple[StreamingTranscriptionEvent, ...]: ...
    async def close(self) -> tuple[StreamingTranscriptionEvent, ...]: ...
```

Normalized output:

``` json
{
  "language": "vi",
  "segments": [
    {
      "start_ms": 0,
      "end_ms": 4200,
      "text": "...",
      "speaker_label": "speaker_1",
      "confidence": 0.94
    }
  ]
}
```

Nếu provider không hỗ trợ diarization/streaming, adapter phải báo
capability false. UI/backend không được giả tính năng.

Realtime adapter emits normalized `partial` or `final` events. Partial events
are delivery-only and must never be persisted. Each final event is mapped to a
`SegmentVersion` in the active STT `TranscriptVersion`; provider speaker labels
are mapped to the meeting's `Speaker` records. `STTProviderError` includes a
stable code and `retryable` flag so a retryable interruption leaves the socket
usable while a non-retryable one fails the meeting. Provider SDK credentials,
including `STT_API_KEY`, stay inside the adapter factory/process.

## 3. Translation contract

``` python
class TranslationCapabilities:
    supported_language_pairs: set[tuple[str, str]]

class TranslationProvider:
    def capabilities(self): ...
    async def translate_segments(self, segments, source, target): ...
```

Demo requirement: VI ↔ EN.

Translation and LLM factories are registered in their backend-only registries.
Business services use only these contracts. The durable AI job payload stores
the transcript version and provider-neutral request fields; a worker claims it,
normalizes the provider result, and records a stable failure code/retryability
when no result can be persisted.

## 4. LLM contract

``` python
class LLMCapabilities:
    structured_output: bool
    max_context_tokens: int | None

class LLMProvider:
    def capabilities(self): ...
    async def generate_summary(self, transcript, template, schema): ...
```

Summary normalized schema: - overview - key_points - action_items -
decisions - risks_notes

Templates: `general`, `briefing`, `voting`.

## 5. Provider registry

``` text
STT_PROVIDER=<name>
TRANSLATION_PROVIDER=<name>
LLM_PROVIDER=<name>
```

Registry maps name → adapter factory.

Không import vendor SDK trong domain/service layer.

## 6. Adding a new provider

Agent phải: 1. implement adapter; 2. map vendor response → normalized
model; 3. declare capabilities; 4. add config validation; 5. add
contract tests; 6. add integration test behind env flag; 7. không sửa
public API nếu capability đã nằm trong abstraction.

## 7. Demo provider selection

Chưa khóa vendor trong architecture. Trước deploy, chọn ít nhất một STT
adapter thật đáp ứng Việt + Anh, batch, diarization và nếu demo realtime
thì streaming. Provider có thể đổi mà không thay public frontend API.
