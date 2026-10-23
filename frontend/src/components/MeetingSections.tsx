import { useEffect, useRef, useState } from "react";
import { meetingsApi } from "../api/endpoints";
import { MEETING_SECTIONS_CHANGED, notifyMeetingSectionsChanged } from "../api/meetingEvents";
import { useAsync } from "../hooks/useAsync";
import type { MeetingSection } from "../types/domain";
import { can } from "../utils/permissions";
import { formatTimestampInput, parseTimestampInput } from "../utils/time";
import { Button, Empty, Failure, Icon, Loading } from "./ui";

type Draft = { id: string | null; title: string; start: string; end: string; revision: string; first: boolean; last: boolean; original: string };
export function sectionTimestamp(ms: number) {
  return formatTimestampInput(ms) + (ms % 1000 ? "." + String(ms % 1000).padStart(3, "0") : "");
}
const draftText = (draft: Pick<Draft, "title" | "start" | "end">) => JSON.stringify([draft.title, draft.start, draft.end]);

/** A sibling overlay; grouping edits never operate on capture, audio or transcript. */
export function MeetingSectionsDialog({ meetingId, close }: { meetingId: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const meeting = useAsync(() => meetingsApi.get(meetingId), [meetingId]);
  const sections = useAsync(() => meetingsApi.sections(meetingId), [meetingId]);
  const [draft, setDraft] = useState<Draft>();
  const [deleting, setDeleting] = useState<MeetingSection>();
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [saveError, setSaveError] = useState("");
  const [notice, setNotice] = useState("");
  const [discarding, setDiscarding] = useState(false);
  const editable = Boolean(meeting.data && can(meeting.data.permission, "edit"));
  const dirty = Boolean(draft && draftText(draft) !== draft.original);
  const stale = Boolean((draft || deleting) && (draft?.revision ?? deleting?.revision ?? "") !== (sections.data?.[0]?.revision ?? ""));

  useEffect(() => {
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => { element?.close(); document.body.style.overflow = previousOverflow; if (previousFocus?.isConnected) previousFocus.focus(); };
  }, []);

  useEffect(() => {
    const update = (event: Event) => {
      if ((event as CustomEvent<{ meetingId: string }>).detail?.meetingId === meetingId) void sections.reload();
    };
    const refresh = () => { void sections.reload(); void meeting.reload(); };
    window.addEventListener(MEETING_SECTIONS_CHANGED, update);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener(MEETING_SECTIONS_CHANGED, update); window.removeEventListener("focus", refresh); };
  }, [meetingId, sections.reload, meeting.reload]);

  function requestClose() {
    if (saving.current) return;
    if (dirty) setDiscarding(true);
    else close();
  }
  function edit(section?: MeetingSection, index = 0) {
    if (draft || deleting || saving.current) return;
    const values = { title: section?.title ?? "", start: section ? sectionTimestamp(section.start_ms) : "00:00", end: section?.end_ms != null ? sectionTimestamp(section.end_ms) : "" };
    setDraft({ ...values, id: section?.id ?? null, revision: sections.data?.[0]?.revision ?? "", first: index === 0, last: index === (sections.data?.length ?? 0) - 1, original: draftText(values) });
    setSaveError(""); setNotice("");
  }
  async function mutate(operation: () => Promise<unknown>, message: string) {
    if (!editable || saving.current || stale) return;
    saving.current = true; setBusy(true); setSaveError(""); setNotice(""); setDiscarding(false);
    try {
      await operation();
      setDraft(undefined); setDeleting(undefined);
      await sections.reload();
      setNotice(message);
      notifyMeetingSectionsChanged(meetingId);
    } catch (cause) {
      setSaveError((cause as Error).message);
      // Keep the original revision and draft; never replay silently against a changed layout.
      void sections.reload();
    } finally { saving.current = false; setBusy(false); }
  }
  function save() {
    if (!draft) return;
    const start = parseTimestampInput(draft.start);
    const end = draft.end.trim() ? parseTimestampInput(draft.end) : null;
    if (!draft.title.trim() || start === undefined || end === undefined) {
      setSaveError("Nhập tên và mốc hợp lệ dạng mm:ss hoặc hh:mm:ss (có thể thêm .123 giây)."); return;
    }
    const body = { title: draft.title.trim(), start_ms: start, expected_revision: draft.revision };
    void mutate(() => draft.id
      ? meetingsApi.updateSection(meetingId, draft.id, { ...body, end_ms: end })
      : meetingsApi.createSection(meetingId, body), "Đã lưu phân chia phiên. Transcript và âm thanh không thay đổi.");
  }

  return <dialog ref={dialog} id="meeting-sections-dialog" className="dialog meeting-sections-dialog" aria-labelledby="meeting-sections-title" aria-describedby="meeting-sections-hint" onCancel={(event) => { event.preventDefault(); requestClose(); }}>
    <button className="close" type="button" autoFocus aria-label="Đóng quản lý phiên họp" disabled={busy} onClick={requestClose}><Icon name="close" /></button>
    <h2 id="meeting-sections-title">Các phiên trong cuộc họp</h2>
    {meeting.data && <p className="meeting-sections-context">{meeting.data.title}</p>}
    <p id="meeting-sections-hint">Thêm, xóa, đổi tên hoặc sửa mốc phiên, không tạm dừng ghi âm. Đây chỉ là cách phân nhóm: transcript và âm thanh không bị sửa hay xóa.</p>
    <p className="muted">Mốc tính trên thời lượng đã ghi, không tính lúc nghỉ. Đoạn thoại được xếp theo mốc bắt đầu, không bị cắt đôi. Sửa ranh giới sẽ cập nhật phiên bên cạnh; bản tóm tắt cũ giữ nguyên. Luôn giữ ít nhất một phiên bao phủ cuộc họp.</p>
    {(meeting.loading || sections.loading) && <Loading label="Đang tải phiên họp…" />}
    {meeting.error && <Failure error={meeting.error} retry={meeting.reload} />}
    {sections.error && <Failure error={sections.error} retry={sections.reload} />}
    {saveError && <div className="form-error" role="alert">{saveError}</div>}
    {notice && <p className="notice" role="status">{notice}</p>}
    {!sections.loading && !sections.error && sections.data?.length === 0 && <Empty title="Chưa có phiên họp" detail="Thêm phiên đầu tiên tại 00:00, sau đó thêm các mốc phân chia." />}
    {sections.data?.map((section, index, all) => <div className="meeting-section-row" key={section.id}>
      <div><strong>Phiên {section.sequence} · {section.title}</strong><small>{sectionTimestamp(section.start_ms)}{section.end_ms !== null ? " – " + sectionTimestamp(section.end_ms) : " →"} · {!section.is_started ? (section.end_ms === null ? "Chờ ghi âm" : "Chưa ghi âm") : section.end_ms !== null ? "Đã khép lại" : "Đang mở"}</small></div>
      {editable && <div className="meeting-section-actions"><Button disabled={busy || Boolean(draft || deleting)} onClick={() => edit(section, index)}>Sửa phiên</Button><Button tone="danger" disabled={busy || all.length < 2 || Boolean(draft || deleting)} onClick={() => { setDeleting(section); setSaveError(""); setNotice(""); }}>Xóa phiên</Button></div>}
    </div>)}
    {editable && sections.data && !sections.error && !draft && !deleting && <Button disabled={busy} onClick={() => edit()}>Thêm phiên tại mốc thời gian</Button>}
    {draft && <form className="section-editor" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <h3>{draft.id ? "Sửa phiên" : "Thêm phiên"}</h3>
      <fieldset disabled={busy}>
        <label className="field">Tên phiên<input autoFocus value={draft.title} maxLength={255} required onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <div className="section-time-fields">
          <label className="field">Bắt đầu<input value={draft.start} disabled={draft.id ? draft.first : !sections.data?.length} required placeholder="00:00" onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
          {draft.id && <label className="field">Kết thúc<input value={draft.end} disabled={draft.last} placeholder="Đang mở" onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>}
        </div>
        <p className="muted">{draft.id ? "Giữ mốc đầu và cuối cuộc họp. Các ranh giới ở giữa có thể điều chỉnh." : "Mốc mới sẽ tách phiên hiện có thành hai phiên; không di chuyển hay cắt nội dung."}</p>
        <div className="dialog-actions"><Button disabled={busy} onClick={() => { setDraft(undefined); setSaveError(""); }}>Hủy sửa</Button><Button type="submit" disabled={busy || stale}>{busy ? "Đang lưu…" : "Lưu phiên"}</Button></div>
      </fieldset>
    </form>}
    {deleting && <div className="notice" role="alert">
      <p>Xóa phiên “{deleting.title}”? {deleting.sequence === 1 ? "Thời gian của phiên sẽ gộp vào phiên kế tiếp." : "Thời gian của phiên sẽ gộp vào phiên trước."} Không xóa transcript, âm thanh hay tóm tắt đã tạo.</p>
      <div className="dialog-actions"><Button disabled={busy} onClick={() => setDeleting(undefined)}>Giữ phiên</Button><Button tone="danger" disabled={busy || stale} onClick={() => void mutate(() => meetingsApi.deleteSection(meetingId, deleting.id, deleting.revision ?? ""), "Đã xóa phân chia phiên; toàn bộ nội dung vẫn được giữ.")}>Xác nhận xóa phiên</Button></div>
    </div>}
    {stale && <div className="form-error" role="alert">Danh sách phiên vừa thay đổi. Bản nháp vẫn được giữ; hãy ghi lại thay đổi cần thiết, hủy sửa hoặc giữ phiên rồi mở lại để dùng mốc mới nhất.</div>}
    {discarding ? <div className="notice" role="alert"><p>Có thay đổi phiên chưa được lưu. Bỏ thay đổi và đóng?</p><div className="dialog-actions"><Button onClick={() => setDiscarding(false)}>Tiếp tục sửa</Button><Button tone="danger" onClick={close}>Bỏ thay đổi và đóng</Button></div></div>
      : <div className="dialog-actions"><Button disabled={busy} onClick={requestClose}>Đóng</Button></div>}
  </dialog>;
}
