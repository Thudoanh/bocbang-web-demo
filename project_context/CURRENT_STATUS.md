# Current Status

_Cập nhật lần cuối: 2026-10-22 — chọn phiên tóm tắt và quản lý mốc phiên._

## Done

- Tóm tắt phiên có checkbox/all/none và gửi IDs + revision; backend phân nhóm
  toàn timeline trước rồi chỉ snapshot/gọi AI phần đã chọn. IDs rỗng/trùng/
  foreign/deleted bị từ chối, stale layout trả 409. Legacy omit IDs giữ all.
  Đổi selection tạo SummaryVersion mới; kết quả hiển thị snapshot lần tạo,
  không tự biến theo checkbox hay layout hiện tại. Không đổi adapter/provider.
- Hộp Phiên họp thêm mốc nội bộ, sửa tên/range (giữ mili giây), xóa có xác nhận
  và gộp vào láng giềng; giữ tối thiểu một phiên và mốc đầu/cuối. Meeting row
  lock + computed revision chống stale, sequence renumber 2-phase tránh unique.
  Chỉ sửa meeting_sections, không đổi transcript/version/speaker/audio/media/
  summary snapshot, không điều khiển ghi âm; dữ liệu legacy khởi tạo tại 0.
  Nháp giữ qua lỗi/refresh và cảnh báo bỏ nháp; không migration mới.

- Tạm dừng mở native dialog hai lựa chọn. Tạo phiên mới mới split; Chỉ tạm
  dừng/Close/Escape giữ nguyên phiên. Mở hộp chưa pause, thông báo rõ đang thu,
  mặc định focus nhánh an toàn, chống chọn lặp và tự đóng khi state không còn
  recording. Không auto resume hoặc hoàn tất meeting/gọi AI khi tạm dừng.
- Plain pause/resume dùng acknowledge:true opt-in; server trả recording.paused/
  recording.resumed sau thao tác provider, client chờ ACK mới đổi paused/thu lại.
  resumed.new_section phản ánh pending section thật (kể cả reconnect), không
  đoán mọi reconnect là phiên mới. Legacy command không cờ giữ response cũ;
  không migration, không sửa dữ liệu phiên cũ/AI/recording playback.

- Search sidebar chỉ dùng viền focus-within ở khung ngoài; input focus/
  focus-visible không outline/shadow riêng, tránh hai hình chữ nhật lồng nhau.
  Giữ accessible label/type=search, logic tìm kiếm và focus của form khác.

- Explicit end flush PCM/STT rồi enqueue recording_assembly độc lập AI trong
  completion transaction. Worker snapshot/validate chunks, ghép WAV temp theo
  timeline, private storage + MediaFile/job completed atomically; queue/storage
  retry, không publish partial/đổi meeting failed. Không thêm migration (0017).
- GET recording read-only; POST edit cho completed realtime, restore cũ/retry
  explicit, không duplicate active/ready. No audio/deleted báo thật; owner xóa
  băng tổng xóa raw chunks, giữ tombstone không tự hồi sinh. Gaps giữa kết nối
  đệm silence có warning; đầu thiếu/nội bộ thiếu/format hỏng/overlap fail rõ ràng.
- Nghe lại trên toolbar mở mini player phía trên icon, thay player inline lớn:
  play/pause/seek/time/speed/download, no autoplay, close/Escape pause/return focus,
  timestamp scoped seek/play và highlight. URL TTL/Range, refresh giới hạn; reload
  vẫn đọc media bền vững. Sidebar/recording host và đo clearance không thay đổi.
- Sửa Request thiếu trong download handler; ticket playback/local download
  stream <=1MiB/phần, S3 giữ presigned redirect. Không đổi provider/credentials.

- Toolbar bỏ panel/nền/blur/bóng chung; từng nút tròn có surface/viền/bóng nhẹ
  riêng, timer/trạng thái chip trái, gaps click-through. Giữ icon/tooltips/
  selected/44px/confirmation và host/controller, sidebar-aware centering.
- Routine info không thêm hàng thường trực, ở tooltip timer hover/focus và
  live region; lỗi/cảnh báo hiện banner riêng. Phân loại UI explicit cho
  retryable errors/reconnect, không nuốt lỗi khi state vẫn recording. Fallback
  và lỗi dịch vẫn hiện rõ, actual toolbar height tiếp tục đo để chừa nội dung.

- Bỏ BẢN GHI/tiêu đề Bản ghi lớn, đưa tên meeting/metadata nhỏ và actions ACL
  vào thanh header cạnh nút sidebar. Transcript full width, top inset 12px,
  bỏ margin đầu Nội dung; tên dài ellipsis, actions mobile xuống hàng.
- Toggle sidebar ngoài panel trên authenticated pages; desktop thu gọn hoàn
  toàn, nhớ localStorage/fallback. Mobile drawer độc lập preference, bắt đầu
  đóng, giữ backdrop/Escape/focus trap/return/body scroll và đổi breakpoint.
  Content/toolbar căn lại theo width=0, không unmount workspace/editor/bộ ghi;
  portal host header/recording giữ ổn định. Không sửa backend/API/DB/provider.

- Bỏ khung Ghi âm phía trên transcript; start/pause/resume/end ở toolbar icon,
  đồng hồ/trạng thái luôn hiện và feedback/lỗi đọc được. Kết thúc vẫn phải xác
  nhận. Hiển thị/Ẩn bản dịch ở bên phải Nội dung, không đổi split/cache/toggle.
- Bảy công cụ icon-only có tooltip hover/focus, Escape/accessible labels và
  hit target 44px; Bản ghi dùng icon transcript. Làm mịn giữ dấu trạng thái,
  spinner và tooltip lý do khóa. Toolbar flex xuống hàng và đo chiều cao thật
  để chừa khoảng transcript, kể cả khi cảnh báo dài.
- RecordingPanel vẫn sở hữu lifecycle ở trang; portal trình bày vào host ổn
  định của AppShell. Không đổi capture/STT/socket/pause/resume/session/AI/API,
  provider/credentials/DB. Build + 60 tests pass; chưa browser/microphone thật.

- Vùng Nội dung khi ẩn dịch chỉ có transcript gốc toàn chiều rộng. Khi bật
  dịch realtime, hai cột bằng nhau với tiêu đề gốc trái/dịch phải; mỗi segment
  ghép đúng logical ID trong grid row cùng chiều cao/vùng cuộn, lặp metadata
  người nói/timestamp và target language thật của từng đoạn (cả auto VI/EN).
- Bỏ card dịch nằm dưới lời gốc. Partial/chưa có bản dịch hiện placeholder,
  không fake text. Giữ editor/voice/merge/delete/player anchor phía gốc, live
  finals/partials và thứ tự hiện tại. Ẩn/hiện cache sau end bằng nút ở Nội dung;
  toggle dịch không gọi pause/stop. Không đổi provider/backend/API/migration.

- Bỏ panel Duyệt transcript làm mịn phía trên transcript. Toolbar bảy mục
  thêm Làm mịn mở native dialog qua portal; không đổi route/unmount workspace,
  không auto-open/auto-accept. AI sau end vẫn do backend enqueue như trước.
- Nút hiện pending/chờ duyệt/đã chốt/lỗi/stale và khóa kèm lý do khi chưa end/
  không transcript; capability/ACL chi phối tạo/chốt nhưng read được xem output.
  Dùng một controller cho polling và editor, giữ nháp/revision qua refresh/lỗi,
  cảnh báo nháp khi đóng/Escape, chống gửi lặp, so gốc/sửa/lưu nháp/chốt.
- Chốt phát scoped transcript event để Bản ghi tải current mới. UI đọc metadata
  và transcript limit=1 để kiểm tra điều kiện, chỉ 404 mới coi là thiếu; không
  giả lỗi mạng thành trống. Pending poll 2s, read error 5s, unfinished metadata
  10s + events/focus; terminal không poll liên tục. Mobile toolbar tự xuống hàng
  và đo chiều cao để tránh che nội dung. Không sửa backend/API/prompt/DB/env.

- Bỏ khung Các phiên trong cuộc họp phía trên transcript. Toolbar sáu mục thêm
  Phiên họp, là button mở native dialog tại chỗ từ mọi trang công cụ meeting,
  không chuyển route/unmount RecordingPanel hay gửi lệnh pause/stop.
- Hộp chỉ tải meeting/sections khi mở; hiện tên/range/trạng thái, rename theo
  quyền edit, read/comment chỉ xem. Có loading/error/retry/empty, chống lưu lặp,
  giữ nháp khi refresh/lỗi, cảnh báo bỏ nháp, Escape/Đóng và trả focus.
- Sự kiện sections đổi mang meetingId cập nhật hộp đúng cuộc họp sau pause/
  resume/end/rename. Sau pause chỉ nhắc mở Phiên họp để đặt tên, không tự mở.
  Giữ boundary/pause/resume/tóm tắt/backend API/migration và dữ liệu hiện có.

- Bản ghi bỏ hẳn khung Thông tin/Bình luận/Phiên bản và component/state/CSS
  liên quan, không chuyển thành menu hay hộp thoại. Ghi âm, player và transcript
  dùng một cột; Phiên họp/Làm mịn mở hộp từ toolbar, không giữ cột phải.
- Bỏ fetch/reload comments và transcript version list chỉ phục vụ khung cũ,
  cùng badge số version và thông báo kỹ thuật không cần thiết. Giữ các reload
  transcript/speakers/sections và quyền sửa. Không sửa backend/API/ACL/schema,
  không xóa dữ liệu bình luận hoặc lịch sử/revision, không thêm migration.

- Bấm Bóc Băng hoặc vào `/`/`/meetings` hiển thị form tên cuộc họp ở giữa,
  một nút mũi tên/Enter. Ghi chú/ngôn ngữ/người nói thu gọn trong Tùy chọn.
  Upload mode qua sidebar giữ form riêng theo nguồn, đi tiếp đến chọn tệp.
- Không lặp nút khởi tạo ghi âm/tải bản ghi trong main home/history/mobile header.
  Lịch sử vẫn ở sidebar; Xem tất cả mở `/history` để lọc/quản lý/xóa media/meeting.
- Bỏ theme nổi ở góc authenticated workspace; chuyển vào Cài đặt → Giao diện
  với nhãn sáng/tối, giữ localStorage/browser scope. Không đổi backend/API,
  dữ liệu cuộc họp, logic AI làm mịn hay tự khởi động microphone khi vào home.

- Tạm dừng của UI flush microphone/upstream/finals/audio, chốt phiên cũ và tạo
  phiên kế tiếp có tên, đang chờ. Chỉ resume ACK mới thu tiếp; trạng thái pause
  được giữ khi socket reconnect. Navigation/disconnect không tạo thêm phiên.
- Nút Phiên họp có danh sách/range/tên phiên và rename ACL edit. Backfill meeting cũ
  thành một Phiên 1; không đoán lại ranh giới. Upload batch cập nhật phiên đầy đủ.
- Tóm tắt UI mặc định từng phiên, mẫu/custom và VI/EN đều dùng được. Job chụp
  text (kể cả edits/làm mịn), tên/range; gọi LLM riêng, không publish partial
  output khi một nhóm lỗi. Empty session content=null, không fake AI result.
- Từng phiên có card sửa riêng, lưu version và expected_version_no chống ghi
  đè; giữ metadata/các phiên khác. Scope toàn meeting và output cũ vẫn đọc được.
  Merge transcript qua ranh giới bị từ chối; làm mịn giữ timing nên giữ nhóm.
- Migration 0017 thêm meeting_sections + summary scope/identity và backfill.
  Không thay credentials/provider config, không rebuild/restart stack.

- Kết thúc qua socket chờ upstream flush hết finals/corrections rồi commit
  completed + durable `transcript_polish` job; bỏ HTTP complete chạy song song
  ở frontend. Complete lặp không tạo job lặp; pause/disconnect không làm mịn.
- Gemini/Groq + fallback dùng contract proofreading riêng, không schema summary.
  Chụp cả edit events nguồn; dài chia nhóm có ngữ cảnh trước/sau, validate alignment.
- Nút Làm mịn tự đọc/poll proposal khi hoàn tất; mở hộp đối chiếu gốc, sửa, lưu nháp backend,
  chốt. Chốt một user_edit/checkpoint, giữ timing/speaker/logical IDs/STT gốc;
  source/AI-generated/draft riêng. ACL và source/draft conflicts được kiểm tra.
  Job payload dùng bảng hiện tại, không có migration mới cho tính năng này.

- Không bắt buộc thu giọng trước: Bản ghi có `Gán tên / Lưu giọng`, nghe đoạn,
  chọn nhiều đoạn cùng người (10–25 giây), tạo/bổ sung reusable voice profile
  qua durable job. Có thể chỉ gán tên khi chưa đủ âm thanh.
- Realtime lưu WAV chunks mỗi 5 giây và pause/stop/disconnect vào private storage;
  migration `0016`. Upload cũ có thể lấy mẫu từ file nguồn theo transcript/job
  provenance; từ chối nhiều file cũ không xác định được nguồn. Transcript dài
  được đọc hết các cursor để thư ký chọn cả những đoạn sau 100/500 dòng đầu.
- Worker chụp clip, kiểm tra lại ACL/timing/speaker trước/sau provider, commit
  mẫu/tên/manual edit events/job success cùng transaction. Thành công nạp lại
  known speakers trên socket hiện tại bằng `speakers.refresh`, giữ timeline/pause.
- Mẫu tái sử dụng theo owner/member scope; quản lý thư viện cá nhân chỉ cho chủ
  profile sửa/xóa. Audio realtime cũ không từng lưu không thể lấy mẫu từ chữ.
- Sidebar trái hiển thị meeting thật theo ACL, nhóm ngày, tìm kiếm có debounce,
  tải thêm 50 meeting/lần, đánh dấu meeting đang mở; đồng bộ sau đổi tên/xóa/
  hoàn tất. Thanh Bản ghi/Tóm tắt/Người nói/Bản dịch/Xuất chuyển xuống đáy vùng
  làm việc. Mobile mở lịch sử bằng ngăn kéo; Mẫu giọng/Cài đặt ở menu tài khoản.
- Mọi nút `Kết thúc` trong panel ghi âm đều mở alert dialog xác nhận. `Hủy`
  giữ nguyên phiên ghi; chỉ `Xác nhận kết thúc` mới gọi luồng stop/complete.
- Ngắt WebSocket do rời trang/chuyển sang công cụ khác không còn tự chuyển
  meeting sang `completed`; lần mở lại hiển thị `Tiếp tục ghi âm`. Chỉ lệnh
  `recording.stop` hoặc endpoint hoàn tất mới kết thúc meeting.
- AudioWorklet được nối vào output im lặng để Chromium tiếp tục xử lý microphone
  khi tab trình duyệt chạy nền; không có visibility handler tự pause khi đổi tab.
- Trang tóm tắt có hai lựa chọn: mẫu `general`/`briefing`/`voting` giữ schema
  năm trường ổn định, hoặc prompt 1–4000 ký tự trả một nội dung tự do theo đoạn
  văn/tiêu đề/danh sách người dùng yêu cầu. Prompt được lưu trên từng version.
- Có nút `Sửa`; nội dung người dùng lưu thành `SummaryVersion` mới với
  `provider=user`, không ghi đè lịch sử. ACL edit được kiểm tra ở backend.
- Migration `20261020_0014` thêm/backfill prompt; `20261020_0015` thêm mode và
  unique identity theo mode. Capability công bố cả ba mẫu và custom prompt.
- Đã sửa partial bị giữ mãi khi final rút ngắn timestamp: đối chiếu chữ đã
  xác nhận và SDK utterance/turn boundary; không chốt nhầm partial mới hơn.
  Frontend thay preview theo final turn ID, chống partial cũ xuất hiện lại
  sau fetch. Khi dừng/lỗi terminal, draft còn lại ghi rõ chưa xác nhận/chưa lưu.
- Speechmatics realtime gom các fragment liên tiếp cùng người nói/ngôn ngữ
  vào preview tích lũy có turn ID ổn định. Timestamp/text corrections thay
  snapshot; partial chưa xác nhận hoãn final timer. Giữ ranh giới người nói/
  khoảng ngừng, xử lý late final và chống partial cũ/reconnect xóa nhầm ô.
- Đã thêm regression tests và kiểm tra adapter → WebSocket → SQLite: ba mảnh
  từ được lưu thành một segment. Không sửa dữ liệu transcript đã có.
- React + TypeScript + Vite frontend đang dùng API thật: auth/OTP/recovery/
  Google OAuth, meeting ACL, History filter và full-name update.
- FastAPI modular monolith với async SQLAlchemy; Alembic head `20261020_0017`.
- Upload/media: size/duration validation, FFmpeg normalization, local/S3 storage,
  durable job; Redis/Dramatiq worker và reconciler chạy process riêng.
- Speechmatics batch/realtime là primary trong env mẫu; AssemblyAI fallback
  khi lỗi retryable lúc mở stream/batch, không nhận diện tên theo voiceprints.
- Personal/guest voice profiles: sample 10–25 giây, tối đa ba identifiers/profile,
  tối đa 50 identifiers/session round-robin. Migration 0012 bỏ MFCC cũ.
- Realtime PCM16 mono 16 kHz AudioWorklet, start/pause/resume/stop, partial/final,
  speaker correction bảo vệ manual edits, reconnect scope/timestamps.
- Optional realtime VI ↔ EN translation dùng queue theo socket, không lưu DB.
- Transcript edit/split/merge/delete/speaker assignment, current projection,
  snapshots/edit events/checkpoints; backend giữ history/rollback revision,
  không còn giao diện lịch sử/phiên bản trên Bản ghi.
- Uploaded-media player đã có signed playback URL/ticket, Range, seek theo
  segment và highlight đoạn đang phát. Realtime có audio clip phục vụ học giọng
  và durable băng WAV tổng hợp sau end; Nghe lại dùng mini player toolbar.
- Translation và summary Gemini/Groq, summary output language VI/EN; export sáu
  formats qua worker đọc immutable input revision.
- Backend giữ comments, members và share management; UI comments trên Bản ghi
  đã bỏ. Public `/share/:token` đã hiển thị
  metadata + current transcript qua token-scoped read endpoint.
- Docker Compose có PostgreSQL, Redis, migrate, API, worker, reconciler,
  frontend; local volumes persist database/queue/media.
- Đã đồng bộ README, env example, kiến trúc/provider/API/ERD, deployment/config,
  migration guide, planning/QA và trạng thái dự án theo source hiện tại.
- README root đã rút gọn thành hướng dẫn local bằng Docker: tạo env, điền key
  hoặc tắt AI, khởi động, lấy OTP từ log và các lệnh quản lý stack thường dùng.
- `.env` local đã đối chiếu với Settings/env example: thêm 17 biến queue/worker,
  storage/realtime/Speechmatics, chuẩn hóa bốn S3 aliases. Giữ nguyên giá trị
  đã có, credentials và model overrides.
- Đã cập nhật cấu hình STT trong `.env` dự án từ env tham chiếu: Speechmatics
  primary, AssemblyAI fallback và Speechmatics key; giữ các tuning mặc định
  hiện có cùng mọi cấu hình khác. Chưa recreate/restart stack.

## Verification

- Lượt chọn phiên/quản lý mốc: TypeScript/Vite build + 85 frontend tests pass;
  54 backend tests (section management/sessions/AI/realtime) pass bằng SQLite,
  PCM tổng hợp và provider giả. So sánh toàn bộ bảng ngoài meeting_sections
  trước/sau CRUD cho thấy transcript/history/speaker/audio/media/job/summary
  không đổi. Có kiểm tra chọn riêng phiên 2, snapshots sau xóa/đổi layout,
  selection mới thành version mới, invalid IDs/mốc/ACL/stale, live pause →
  thêm/xóa pending → resume → end và legacy initialization. Ruff new modules/
  tests + scoped F/I, diff check pass. Chưa browser/microphone/PostgreSQL/provider
  thật; không tự rebuild/restart Docker, không migration bổ sung.

- Lượt lựa chọn tạm dừng: TypeScript/Vite build + 82 frontend tests pass, thêm
  dialog SSR/source, lựa chọn an toàn/one-shot và socket serialization/ACK thật
  với FakeWebSocket. Backend kiểm tra ordinary pause/resume/reconnect giữ ID,
  repeated pause không thêm phiên, split explicit/pending, parser boolean và
  hồi quy realtime. Chưa browser/microphone thật; không tự rebuild Docker.

- Lượt băng nghe lại: TypeScript/Vite build + 77 frontend tests pass. Backend
  50 regression tests pass (recording/media/realtime/sessions/polish) với SQLite,
  PCM tổng hợp/provider giả ngoài Windows sandbox; có byte-exact assembly,
  pause/reconnect offsets, raw source failures/retry/queue offline/ACL/tombstone,
  Range ticket/download. Ruff new module/tests + scoped F/I và diff check pass.
  Sau chỉnh bounded streaming, chạy lại 21 recording/media/voice-learning tests
  đều pass, gồm tải WAV >1MiB và nhánh worker không khởi tạo AI/STT.
  Chưa browser/microphone, S3/PostgreSQL thực; không tự rebuild/restart Docker.

- Lượt toolbar tách nút: TypeScript/Vite build + 73 tests pass (67 cũ + 6 mới:
  routine/translation info không feedback row, error/reconnect/fallback visible,
  transparent/click-through CSS, severity wiring và controller/confirmation).
  Diff check pass. Chưa browser visual/microphone acceptance, không tự rebuild
  Docker; không đổi backend/API/DB/env/provider hoặc capture/socket commands.

- Lượt header/sidebar: TypeScript/Vite build + 67 tests pass (60 cũ + 7 mới:
  compact header/ACL, preferences/storage blocked, desktop/mobile initial SSR,
  stable controllers/hosts, drawer keyboard/scroll source, CSS width/clearance).
  Diff check pass. Chưa browser layout/focus/microphone acceptance, không tự
  rebuild/restart Docker. Không coi SSR/source tests là runtime microphone E2E.

- Lượt hai cột dịch: TypeScript/Vite build + 51 tests pass (45 cũ, 6 SSR/source/
  CSS cases mới). Kiểm tra hidden/on, metadata/target VI–EN, missing/partial,
  editor/anchor, ID mapping/equal tracks và toggle không có lệnh ghi âm.
  Diff check pass. Chưa visual/browser/microphone/provider acceptance; không
  rebuild/restart Docker. Cache realtime vẫn không được lưu qua reload.

- Lượt chuyển làm mịn: TypeScript/Vite production build + 45 tests pass (14
  reducer, 5 route, 4 landing/theme, 12 workspace/modal/source/CSS, 10 polish
  state). Fixtures kiểm tra gating, pending/review/accepted/failed/stale/read
  errors, ACL, so gốc/editor/draft/explicit accept, no inline panel/no navigate.
  Expected revision và guard không poll ghi đè nháp được kiểm tra source;
  chưa runtime hook/browser/provider/microphone E2E. Diff check pass, không
  rebuild/restart Docker. Cần acceptance trên trình duyệt thật sau rebuild.

- Lượt chuyển quản lý phiên: frontend TypeScript/Vite build + 31 tests pass
  (14 reducer, 5 route, 4 landing/theme, 8 workspace/modal/toolbar/CSS/source).
  Fixture SSR kiểm tra button không href/new route, không còn inline manager/
  sections fetch ở Bản ghi, dialog tên/range/edit ACL và source không chứa lệnh
  audio/navigation. Không coi static checks là chứng minh microphone E2E.
  `git diff --check` pass; chưa rebuild Docker hoặc test browser/provider thật.

- Lượt bỏ side panel: TypeScript/Vite production build và 27 tests pass (14
  transcript reducer, 5 route, 4 landing/theme, 4 workspace render/CSS).
  Fixture SSR kiểm tra realtime/editable, upload/player, completed/read-only,
  làm mịn, không gọi comments/version list; CSS chỉ một grid track. Vite tests
  tắt WebSocket server để chạy song song không tranh port. `git diff --check`
  pass. Chưa rebuild Docker hoặc acceptance browser/microphone/provider thật.

- Lượt home/theme: frontend TypeScript/Vite build pass; 23 tests pass (14
  transcript reducer, 5 route, 4 static-render home/upload/history/theme).
  Render qua Vite SSR không gọi API, không mở browser. `git diff --check` pass.
  Chưa rebuild/restart Docker; cần người dùng thử giao diện đăng nhập, mobile,
  tạo bằng Enter/nút gửi, upload và lưu theme sau reload trên trình duyệt thật.

- Lượt nhiều phiên: final combined regression 80 backend tests pass, gồm 11
  session cases và AI/realtime/speakers/migration/model/polish/transcript/meeting/
  media/worker lifecycle. Test reconnect cũ đã chuyển sang pause/new session,
  không mở lại meeting completed. Frontend production build + 14 reducer tests,
  new-file full Ruff/scoped F/I, compile và diff check pass. Sau bổ sung ACK
  provider flags, 36 session/realtime/speakers tests recheck pass. SQLite/provider
  mô phỏng; chưa acceptance thật.

- Lượt làm mịn: final combined regression 80 backend tests pass (12 proofreading
  cases + AI/transcript/provider/realtime/speakers/meeting/voice learning).
  Frontend TypeScript/Vite build + 14 reducer tests pass. Scoped Ruff, compile
  và diff check pass; provider mô phỏng. Chưa rebuild/restart stack, không gọi Gemini/Groq
  thật hoặc browser/microphone acceptance. Xem `transcript-polish.md`.

- Lượt học giọng: 39 focused backend tests (learning/realtime/speakers/migrations/
  models) pass ngoài Windows sandbox; frontend build và 14 reducer tests pass.
  FFmpeg thật trong container tách biệt, tắt mạng/read-only source đã trích/ghép
  chính xác hai khoảng âm thanh tổng hợp thành 12 giây. Scoped Ruff/compile/diff
  kiểm tra riêng; provider mô phỏng. Chưa rebuild stack hoặc gọi Speechmatics
  thật, theo ưu tiên người dùng tự rebuild/kiểm thử browser.
- Lượt đổi sidebar/thanh công cụ: TypeScript/Vite production build pass;
  `git diff --check` pass. Đã mở Vite đến trang đăng nhập, chưa kiểm thử bố cục
  có đăng nhập/mobile; người dùng yêu cầu tự rebuild Docker và chạy thử.
- Lượt thêm xác nhận kết thúc: frontend TypeScript/Vite production build và
  14 reducer tests pass; `git diff --check` pass. Cần browser acceptance cho
  thao tác Hủy/Xác nhận ở idle, recording và paused sau khi rebuild.
- Lượt sửa vòng đời realtime: frontend TypeScript/Vite production build và 14
  reducer tests pass; Ruff và `py_compile` pass cho route/test backend;
  `git diff --check` pass.
  Đã thêm regression test cho disconnect → reconnect → explicit stop. Test
  WebSocket runtime chưa chạy được trong lượt này vì Windows sandbox chặn
  asyncio socket nội bộ, còn quyền chạy ngoài sandbox bị hệ thống từ chối do
  giới hạn usage; cần chạy lại khi môi trường cho phép.
- Lượt hai chế độ tóm tắt + sửa thủ công/Groq free-form: 33 backend tests
  (AI/provider/model/migration)
  pass ngoài Windows sandbox; frontend TypeScript/Vite production build và
  14 reducer tests pass. Migration upgrade/downgrade SQLite, backfill prompt và
  phân loại mode cũ pass; scoped Ruff F/I và diff check pass. Full backend có
  104 pass/16 fail: 7 export queue/file tests bị lỗi không ổn định trên Windows,
  3 realtime tests lệch trạng thái và 6 voice-profile tests thiếu FFmpeg; không
  lỗi nào thuộc 33 test summary/provider/model/migration. Đã chẩn đoán Groq thật
  bằng dữ liệu giả trên schema cũ; schema mới được test mô phỏng, chưa rebuild
  để gọi provider hoặc kiểm thử browser end-to-end.
- Lượt sửa ô nhận diện: 67 focused backend tests và 14 frontend tests pass;
  TypeScript/Vite build, Ruff adapter/Speechmatics tests, F/I realtime tests,
  `git diff --check` pass. WebSocket/SQLite test kiểm tra final timestamp ngắn
  hơn preview. Các provider được mô phỏng; bản sửa này chưa rebuild Docker.
- Bản sửa phân mảnh trước đã build API/frontend và chạy migration thành công;
  API/frontend/PostgreSQL/Redis healthy, `/ready` ready, frontend HTTP 200,
  capabilities báo Speechmatics streaming/diarization. Người dùng báo chạy ổn
  nhưng còn ô nhận diện; lượt sửa mới cần người dùng rebuild và thử lại.
- Lượt sửa 2026-10-12: 61 backend tests trong Speechmatics/provider/realtime/
  speaker suites và 10 frontend reducer tests pass; TypeScript/Vite build pass.
  Ruff pass cho adapter/Speechmatics tests, F/I pass cho realtime tests;
  `git diff --check` pass. Dependencies test nằm trong `.venv-stt`/`node_modules`
  (Git ignored). Async tests chạy ngoài Windows sandbox để tránh asyncio bị treo.
  Các provider được mô phỏng; chưa gọi Speechmatics thật, chưa restart Docker.
- Task trước ghi nhận 93 backend tests, frontend build, Docker migration/health
  và Speechmatics batch/realtime smoke test bằng file thật. Xem `TASK_LOG.md`
  để biết phạm vi và thời điểm; không coi đó là test mới trong đợt sửa tài liệu.
- Đợt này chỉ sửa tài liệu và config example; xác minh đường dẫn, nội dung
  cấu hình, route/schema/model references và diff. Không chạy provider/browser
  E2E hay thay đổi runtime code.
- Lượt rút gọn README chỉ sửa tài liệu; kiểm tra liên kết, code fences và lệnh
  theo Compose/provider config. Không khởi động lại stack hoặc sửa `.env`.
- Lượt cập nhật `.env`: đủ biến trong env example, không trùng key, kiểm tra
  bảo toàn giá trị có sẵn. Python virtualenv đã validate Settings/queue và
  khởi tạo STT/translation/LLM/email adapter thành công; không gọi provider hay
  kết nối database/Redis, không restart stack.
- Lượt chuyển Speechmatics: kiểm tra key khớp file tham chiếu và chỉ ba biến
  STT được thay đổi, không hiển thị secret. Chưa gọi provider thật để kiểm tra
  key hoặc khởi tạo lại adapter với cấu hình mới.

## In progress

- Người dùng rebuild frontend/API và thử Tạm dừng → Chỉ tạm dừng/Tạo phiên mới,
  Close/Escape/Tab, chọn lặp, resume/reconnect, số phiên/tóm tắt, timer và audio.
  Kiểm tra ghi âm còn tiếp tục khi hộp đang chờ chọn, chỉ resume ACK mới thu lại.

- Người dùng rebuild API/worker/frontend để thử end → pending → ready → Nghe
  lại, tua/timestamp/speed/download/reload, close/Escape và mobile. Meeting cũ
  có chunk dùng Chuẩn bị băng; thử read/edit/outsider, nguồn missing/overlap,
  fallback/retry, URL TTL và S3/PostgreSQL thật. Chưa browser/microphone E2E.

- Người dùng rebuild và thử floating icon riêng trên desktop/mobile/sáng/tối,
  hover/Tab/Escape, click nội dung giữa các nút, selected/disabled/busy và
  timer tooltip. Thử normal/end không thừa hàng, reconnect/lỗi realtime/dịch/
  fallback vẫn đọc được và không che dòng cuối; ghi/pause/resume/end giữ luồng.

- Người dùng rebuild và thử sidebar desktop đóng/mở/reload, mobile backdrop/
  Escape/Tab/resize, tên meeting dài, actions theo quyền và giao diện sáng/tối.
  Thử đang ghi/đang sửa transcript thì toggle sidebar, kiểm tra tiếp tục thu và
  giữ nháp; toolbar căn giữa/không che dòng cuối, dịch vẫn bật/tắt hai cột.

- Người dùng tự rebuild Docker, thử đang ghi → bật dịch → hai cột/đoạn dài/
  partial → ẩn về một cột → hiện lại; thử pause/resume/end và ẩn/hiện cache
  sau end, edit/voice/merge/playback, auto VI/EN/lỗi dịch và màn hình nhỏ.

- Người dùng rebuild Docker, thử Làm mịn khóa trước end/trống, status khi hộp
  đóng, pending → chờ duyệt, mở/so gốc/sửa/lưu nháp/đóng/Escape/chốt. Kiểm tra
  Bản ghi cập nhật sau accept, hai editor/source conflict, lỗi retry, read-only
  và toolbar bảy mục trên mobile. Không cần migration mới cho giao diện này.

- Người dùng tự rebuild Docker, đang ghi thì mở Phiên họp → sửa/lưu/đóng/Escape,
  kiểm tra microphone/transcript tiếp tục; thử nháp, lỗi API, read ACL, mobile,
  pause → nhắc đặt tên → resume và tóm tắt từng phiên. Không cần migration mới.

- Người dùng tự rebuild Docker để thử Bản ghi một cột trên desktop/mobile,
  mở meeting cũ, ghi/pause/resume/end, sửa transcript, học giọng, làm mịn và
  playback. Không có migration hoặc dữ liệu bị xóa cho lượt bỏ side panel.

- Người dùng tự rebuild frontend để kiểm tra Bóc Băng → form tên, mở meeting
  từ sidebar, Xem tất cả → quản lý, Tải bản ghi → upload, Cài đặt → sáng/tối.
  Kiểm tra cả desktop/mobile và lỗi tạo meeting; không cần migration cho UI này.

- Người dùng rebuild API/worker/frontend và chạy migration 0017 rồi thử ghi →
  tạm dừng → đặt tên → tiếp tục nhiều phiên → tóm tắt/sửa từng phiên, paused
  reconnect, chuyển công cụ, end/làm mịn/chốt và meeting cũ. Chưa gọi LLM/STT
  thật hoặc kiểm thử UI/microphone; cần PostgreSQL acceptance cho migration.

- Người dùng rebuild API/worker/frontend rồi thử end giữa câu → AI → so sánh →
  lưu nháp/reload → chốt → lịch sử/export. Chất lượng AI, context meeting dài,
  latency/rate limits, hai editor và provider thật cần acceptance sau rebuild.

- Rebuild cả API/worker/frontend, head `0017` (gồm audio `0016`), rồi thử microphone → gán tên/
  lấy mẫu → tiếp tục nói → cuộc họp tiếp theo; thử audio upload cũ và lỗi mẫu
  ngắn/chéo giọng, profile đủ 3 mẫu. Cần đo nhận diện bằng provider thật.
- Người dùng rebuild Docker để kiểm tra sidebar lịch sử/search/tải thêm, đổi tên/
  xóa, chuyển meeting, thanh công cụ đáy và ngăn kéo mobile.
- Cần rebuild stack và kiểm thử microphone trên browser: đang ghi thì đổi tab
  vẫn nhận transcript; sang Tóm tắt/Bản dịch thì dừng phiên hiện tại, quay lại
  bấm `Tiếp tục ghi âm`; chỉ nút `Kết thúc` làm meeting hoàn tất.
- Cần rebuild stack và kiểm thử browser cả mẫu có sẵn, prompt tùy chỉnh và nút
  Sửa trên Gemini/Groq thật, gồm tạo lại version, đổi VI/EN và export summary.
- Người dùng tự rebuild API/frontend cho bản sửa ô nhận diện, rồi kiểm tra
  câu ngắn, timestamp corrections, stop và terminal disconnect trên microphone.
- Cần microphone E2E tiếng Việt cho bản sửa phân mảnh mới: câu liên tục, ngập
  ngừng ngắn, hai người nói, pause/resume/stop và kiểm tra sau reload.
- Chưa có kết quả browser/microphone E2E đầy đủ cho upload, playback, AI, export,
  sharing, reconnect và name identification trong toàn bộ UX.

## Next

1. Browser/S3 playback/download/TTL smoke test; Request bug đã sửa và test local.
2. Browser/microphone E2E Speechmatics VI/EN, noise/known-unknown voices và
   AssemblyAI fallback; đo accuracy/latency, không suy ra từ fixtures.
3. Kiểm thử browser upload → transcript edit/rollback → playback → AI/export,
   ACL, share expiry/revoke và playback URL expiry.
4. Backend pytest/lint, Alembic validation và integration với isolated PostgreSQL.
5. History pagination/count; settings default language/diarization/phone/storage/
   retention metadata cần contract/migration trước khi thêm UI.
6. Public share summary/translation/media hoặc token-based writes cần thiết kế
   ACL riêng. Endpoint hiện tại chỉ đọc metadata/current transcript.
7. Cấu hình deployment public; Render manifest chưa có trong repo.

## Blockers / risks

- `/ready` chỉ kiểm tra database; không khẳng định Redis/worker/provider khỏe.
- Media download đã sửa và test local; S3/browser acceptance vẫn cần kiểm tra.
- Signed playback URL có TTL; cần kiểm tra UX khi URL hết hạn.
- Reconnect tạo stream và generic speaker scope mới, không đảm bảo cùng voice
  giữ ID qua nhiều phiên.
- Storage cleanup chạy trước DB cascade, không atomic với object storage.
- Lint/test môi trường local và provider credentials ảnh hưởng verification;
  không coi build/static QA là acceptance browser.
