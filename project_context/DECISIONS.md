# Implementation Decisions

Đây là bản tóm tắt tham chiếu nhanh các quyết định kiến trúc và kỹ thuật cần tôn trọng trong toàn bộ dự án.

## 1. Giao diện & Tương tác (Frontend)
- Frontend dùng React + TypeScript + Vite; API base URL và WebSocket URL lấy từ `VITE_API_BASE_URL` và `VITE_WS_BASE_URL`.
- Không đưa provider credential hoặc secret key AI vào frontend; toàn bộ xử lý AI đều được gọi và bảo mật ở Backend.
- Tất cả thao tác async dùng job status do backend trả về; frontend không báo hoàn tất trước khi job đạt terminal state.
- Giao diện phải kiểm tra `hasTranscriptContent` trước khi hiển thị trạng thái rỗng hoặc lỗi; tiếp tục polling cho đến khi các segments nạp xong hoàn toàn, tránh tình trạng false-positive báo lỗi đỏ khi cuộc họp đã hoàn tất.

## 2. Kiến trúc AI & Bóc băng (STT Pipeline)
- **Kiến trúc Dual-Engine cho tệp tải lên:**
  - Kết hợp đồng thời Groq Whisper Turbo LPU (`whisper-large-v3-turbo`) để trả về văn bản bản nháp siêu tốc (< 3 giây) và Speechmatics Batch API để phân tách mốc thời gian và định danh từng người nói chính xác.
  - Sau khi có kết quả thô, dùng LLM (`qwen/qwen3.8-27b` hoặc `llama-3.3-70b-versatile`) để tinh chỉnh phân vai người nói, sửa lỗi chính tả đồng âm tiếng Việt và xóa câu rác / ảo giác.
  - Cấm tuyệt đối gán người nói theo công thức xoay vòng giả (`index % 4 + 1`); chỉ gán nhãn dựa trên giọng nói thực tế hoặc ngữ cảnh phân vai.
- **Chuẩn hóa ngôn ngữ mặc định:**
  - Khi client gửi `language_mode: "auto"`, backend luôn tự động map về `"vi"` (tiếng Việt) cho các STT adapter không hỗ trợ tham số "auto" (như Speechmatics), tránh ném ngoại lệ `STT_LANGUAGE_UNSUPPORTED` làm sập background worker.
- **Chiến lược dịch thuật song ngữ (Translation):**
  - Sử dụng Groq Translation API làm dịch vụ chính vì tốc độ xử lý tức thì (~0.3s/câu).
  - Tự động fallback sang Google Translate (GTX) nếu Groq bị giới hạn rate-limit hoặc lỗi kết nối để đảm bảo không bao giờ để trống bản dịch của người dùng.

## 3. Ghi âm trực tiếp (Real-time Stream)
- Thu nhận âm thanh PCM16 mono 16kHz qua `AudioWorklet`, stream qua WebSocket.
- Sử dụng Speechmatics Realtime WebSocket (`wss://eu2.rt.speechmatics.com/v2`) làm dịch vụ chính; AssemblyAI làm fallback khi cần.
- Hàng đợi dịch song ngữ trực tiếp độc lập (`RealtimeTranslationSession`) để không làm nghẽn vòng lặp nhận âm thanh WebSocket.
- Duy trì snapshot bản dịch trực tiếp trên server và localStorage trên client để chống mất dữ liệu khi người dùng ấn F5 tải lại trang.

## 4. Dữ liệu & Lưu trữ (Storage & Database)
- Tách biệt hoàn toàn khỏi Supabase Storage; sử dụng SeaweedFS (chuẩn S3-compatible) kết hợp local persistent volume trên cluster để lưu trữ tệp âm thanh gốc và tệp chuẩn hóa WAV 16kHz.
- Mỗi lần chỉnh sửa kịch bản tạo một `transcript_version` mới, không ghi đè version cũ để bảo toàn lịch sử và hỗ trợ rollback.
- Phân quyền theo meeting ACL: `read`, `comment`, `edit`, `owner`; owner là cấp duy nhất được quản lý chia sẻ hoặc xóa meeting.

## 5. Hạ tầng & Triển khai (DevOps)
- Hệ thống chạy trên cụm Kubernetes (`k8s/bocbang.yaml`) tại server `http://htm.democloud.xyz`.
- Pipeline CI/CD tự động build Docker images trên runner `build_images_204`, đẩy lên private registry `registry.h2qsolution.com/boc-bang-new/` và tự động rollout restart các pods backend, worker, reconciler và frontend.
