import { useEffect, useRef, useState } from "react";
import { meetingsApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import type { Meeting, MeetingStatus } from "../types/domain";
import { Button, Empty, Failure, Icon, Loading, PageHeading, Status, statusLabel } from "../components/ui";

const statuses: Array<{ value: "" | MeetingStatus; label: string }> = [
  { value: "", label: "Tất cả trạng thái" },
  { value: "recording", label: "Đang ghi âm" },
  { value: "processing", label: "Đang xử lý" },
  { value: "completed", label: "Hoàn tất" },
  { value: "failed", label: "Thất bại" },
];

export function MeetingsPage({ createOnly = false, initialSource }: { createOnly?: boolean; initialSource?: "realtime" | "upload" }) {
  return createOnly ? <CreateMeeting initialSource={initialSource} /> : <MeetingsOverview />;
}

function MeetingsOverview() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"" | MeetingStatus>("");
  const [source, setSource] = useState<"" | Meeting["source_type"]>("");
  const [appliedFilters, setAppliedFilters] = useState({
    search: "",
    status: "" as "" | MeetingStatus,
    source: "" as "" | Meeting["source_type"],
  });
  const [mediaMeeting, setMediaMeeting] = useState<Meeting>();
  const [pendingDelete, setPendingDelete] = useState<Meeting>();

  useEffect(() => {
    const timer = window.setTimeout(
      () => setAppliedFilters({ search: query.trim(), status, source }),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [query, status, source]);

  const meetings = useAsync(
    (signal) => meetingsApi.list({
      limit: 50,
      q: appliedFilters.search || undefined,
      status: appliedFilters.status || undefined,
      source_type: appliedFilters.source || undefined,
    }, signal),
    [appliedFilters.search, appliedFilters.status, appliedFilters.source],
  );
  const filtering = Boolean(query || status || source);

  async function deleteMeeting() {
    if (!pendingDelete) return;
    try {
      await meetingsApi.remove(pendingDelete.id);
      setPendingDelete(undefined);
      await meetings.reload();
    } catch (cause) {
      setPendingDelete(undefined);
      window.alert((cause as Error).message);
    }
  }

  return <>
    <PageHeading
      eyebrow="LỊCH SỬ"
      title="Quản lý cuộc họp"
      description="Tìm kiếm, lọc và quản lý dữ liệu các cuộc họp đã lưu."
    />
    <div className="history-tools meeting-tools">
      <label><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm cuộc họp..." /></label>
      <select aria-label="Lọc trạng thái" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
      <select aria-label="Lọc nguồn âm thanh" value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="">Tất cả nguồn</option><option value="realtime">Ghi âm</option><option value="upload">Tải tệp</option></select>
    </div>
    {meetings.loading && <Loading />}
    {meetings.error && !meetings.data && <Failure error={meetings.error} retry={meetings.reload} />}
    {meetings.error && meetings.data && <div className="notice">Chưa thể cập nhật bộ lọc. Dữ liệu gần nhất vẫn được giữ lại. <Button onClick={meetings.reload}>Thử lại</Button></div>}
    {meetings.data && meetings.data.length === 0 && (
      filtering
        ? <Empty title="Không tìm thấy" detail="Thử từ khóa hoặc bộ lọc khác." />
        : <Empty title="Chưa có cuộc họp" detail="Chọn Cuộc họp mới hoặc Tải bản ghi trong thanh bên để bắt đầu." />
    )}
    {meetings.data && meetings.data.length > 0 && <div className="meeting-list">{meetings.data.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} onMedia={() => setMediaMeeting(meeting)} onDelete={() => setPendingDelete(meeting)} />)}</div>}
    {mediaMeeting && <MediaDialog meeting={mediaMeeting} close={() => setMediaMeeting(undefined)} />}
    {pendingDelete && <ConfirmDialog title="Xóa toàn bộ cuộc họp?" detail={`Tất cả transcript, tệp media, export và dữ liệu liên quan của “${pendingDelete.title}” sẽ bị xóa.`} confirmLabel="Xóa cuộc họp" close={() => setPendingDelete(undefined)} confirm={() => void deleteMeeting()} />}
  </>;
}

function CreateMeeting({ initialSource }: { initialSource?: "realtime" | "upload" }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("vi");
  const [diarization, setDiarization] = useState(true);
  const [creating, setCreating] = useState<"realtime" | "upload">();
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const sourceType = initialSource ?? "realtime";
  const uploading = sourceType === "upload";

  async function create() {
    if (submitting.current || !title.trim()) return;
    submitting.current = true;
    setCreating(sourceType);
    setError("");
    try {
      const meeting = await meetingsApi.create({
        title: title.trim(),
        description: description.trim(),
        source_type: sourceType,
        language_mode: language,
        diarization_enabled: diarization,
      });
      window.location.assign(sourceType === "realtime" ? `/meetings/${meeting.id}` : `/meetings/${meeting.id}/upload`);
    } catch (cause) {
      setError((cause as Error).message);
      submitting.current = false;
      setCreating(undefined);
    }
  }

  return <section className="meeting-start" aria-labelledby="meeting-start-title">
    <div className="meeting-start-body">
      <h1 id="meeting-start-title">{uploading ? "Tải bản ghi cuộc họp" : "Tạo cuộc họp mới"}</h1>
      <p className="meeting-start-description">{uploading ? "Đặt tên cuộc họp để tiếp tục chọn file âm thanh hoặc video có sẵn." : "Nhập tên cuộc họp để mở không gian ghi âm và phân tích nội dung."}</p>
      <form className="meeting-start-form" aria-busy={Boolean(creating)} onSubmit={(event) => { event.preventDefault(); void create(); }}>
        <div className="meeting-name-entry">
          <input autoFocus required maxLength={255} aria-label="Tên cuộc họp" aria-describedby="meeting-start-hint" placeholder="Ví dụ: Họp team hằng tuần, Thảo luận dự án…" value={title} disabled={Boolean(creating)} onChange={(event) => setTitle(event.target.value)} />
          <Button type="submit" tone="dark" className="meeting-name-submit" disabled={Boolean(creating) || !title.trim()} aria-label={uploading ? "Tạo cuộc họp và tiếp tục tải bản ghi" : "Tạo cuộc họp"}>
            {creating ? <span className="spinner" /> : <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" /></svg>}
          </Button>
        </div>
        <p className="meeting-start-hint" id="meeting-start-hint" role="status">{creating ? "Đang tạo cuộc họp…" : uploading ? "Nhấn Enter hoặc nút mũi tên để tiếp tục tải bản ghi" : "Nhấn Enter hoặc nút mũi tên để tạo cuộc họp"}</p>
        {error && <div className="form-error" role="alert">{error}</div>}
        <details className="meeting-start-options">
          <summary>Tùy chọn cuộc họp</summary>
          <fieldset className="compact-form" disabled={Boolean(creating)}>
            <label className="field full">Ghi chú <span>(không bắt buộc)</span><textarea maxLength={20000} placeholder="Nội dung chính" value={description} onChange={(event) => setDescription(event.target.value)} /></label>
            <div className="field-grid">
              <label className="field">Ngôn ngữ<select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="vi">Tiếng Việt</option><option value="en">English</option><option value="auto">Tự nhận diện Việt / Anh</option></select></label>
              <label className="field">Người nói<select value={String(diarization)} onChange={(event) => setDiarization(event.target.value === "true")}><option value="true">Tự phân biệt</option><option value="false">Không phân biệt</option></select></label>
            </div>
          </fieldset>
        </details>
      </form>
    </div>
  </section>;
}

function MeetingRow({ meeting, onMedia, onDelete }: { meeting: Meeting; onMedia: () => void; onDelete: () => void }) {
  const date = new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(meeting.updated_at));
  const duration = meeting.duration_ms ? ` · ${Math.max(1, Math.round(meeting.duration_ms / 60000))} phút` : "";
  return <article className="meeting-row manageable-meeting-row">
    <a className="meeting-row-link" href={`/meetings/${meeting.id}`} aria-label={`Mở cuộc họp ${meeting.title}`} />
    <div className="avatar">{meeting.title.slice(0, 2).toUpperCase()}</div>
    <div className="meeting-row-main"><strong>{meeting.title}</strong><p>{date} · {meeting.source_type === "realtime" ? "Ghi âm" : "Tệp"}{duration}</p></div>
    <Status value={meeting.status} />
    <div className="row-actions">
      {meeting.permission === "owner" && <Button className="row-secondary-action" onClick={onMedia}>Tệp</Button>}
      {meeting.permission === "owner" && <Button className="row-secondary-action" tone="danger" onClick={onDelete}>Xóa</Button>}
    </div>
  </article>;
}

function MediaDialog({ meeting, close }: { meeting: Meeting; close: () => void }) {
  const media = useAsync(() => meetingsApi.media(meeting.id), [meeting.id]);
  const [pending, setPending] = useState<{ id: string; name: string }>();

  async function remove() {
    if (!pending) return;
    try {
      await meetingsApi.deleteMedia(meeting.id, pending.id);
      setPending(undefined);
      await media.reload();
    } catch (cause) {
      window.alert((cause as Error).message);
      setPending(undefined);
    }
  }

  return <>
    <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="media-title"><button className="close" onClick={close} type="button" aria-label="Đóng">×</button><h2 id="media-title">Tệp của cuộc họp</h2><p>Xóa audio không xóa transcript đã tạo.</p>{media.loading && <Loading />}{media.error && <Failure error={media.error} retry={media.reload} />}{media.data?.length === 0 && <p>Không còn tệp media được lưu.</p>}{media.data?.map((item) => <div className="media-item" key={item.id}><div><strong>{item.original_filename}</strong><small>{(item.size_bytes / 1024 / 1024).toFixed(1)} MB · {statusLabel(item.status)}</small></div><Button tone="danger" onClick={() => setPending({ id: item.id, name: item.original_filename })}>Xóa tệp</Button></div>)}</section></div>
    {pending && <ConfirmDialog title="Xóa tệp audio?" detail={`Tệp “${pending.name}” sẽ bị xóa. Transcript được giữ lại theo chính sách demo.`} confirmLabel="Xóa tệp" close={() => setPending(undefined)} confirm={() => void remove()} />}
  </>;
}

function ConfirmDialog({ title, detail, confirmLabel, close, confirm }: { title: string; detail: string; confirmLabel: string; close: () => void; confirm: () => void }) {
  return <div className="dialog-backdrop"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{detail}</p><div className="dialog-actions"><Button onClick={close}>Hủy</Button><Button tone="danger" onClick={confirm}>{confirmLabel}</Button></div></section></div>;
}
