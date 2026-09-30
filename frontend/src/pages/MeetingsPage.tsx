import { useState } from "react";
import { meetingsApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import type { Meeting } from "../types/domain";
import { Button, Empty, Failure, Loading, PageHeading, Status } from "../components/ui";

export function MeetingsPage() {
  const { data: meetings, loading, error, reload } = useAsync(meetingsApi.list, []); const [title, setTitle] = useState(""); const [creating, setCreating] = useState(false);
  async function create() { if (!title.trim()) return; setCreating(true); try { const meeting = await meetingsApi.create({ title, source_type: "upload", language_mode: "vi", diarization_enabled: true }); window.location.assign(`/meetings/${meeting.id}/upload`); } finally { setCreating(false); } }
  return <><PageHeading eyebrow="CUỘC HỌP" title="Không gian bản ghi" description="Tạo cuộc họp mới hoặc tiếp tục xử lý bản ghi đang có." /><section className="create"><input aria-label="Tên cuộc họp" placeholder="Ví dụ: Họp roadmap sản phẩm" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} /><Button tone="dark" disabled={creating || !title.trim()} onClick={() => void create()}>{creating ? "Đang tạo…" : "Tạo cuộc họp"}</Button></section>
  <div className="section-title"><h2>Gần đây</h2>{meetings && <span>{meetings.length} cuộc họp</span>}</div>
  {loading && <Loading />}{error && <Failure error={error} retry={reload} />}{meetings && !meetings.length && <Empty title="Chưa có cuộc họp" detail="Tạo cuộc họp đầu tiên để tải âm thanh hoặc bắt đầu ghi trực tiếp." />}
  <div className="meeting-list">{meetings?.map((meeting) => <MeetingRow key={meeting.id} meeting={meeting} />)}</div></>;
}
function MeetingRow({ meeting }: { meeting: Meeting }) { return <article className="meeting-row"><div className="avatar">{meeting.title.slice(0, 2).toUpperCase()}</div><div><strong>{meeting.title}</strong><p>{new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium" }).format(new Date(meeting.updated_at))} · {meeting.language_mode.toUpperCase()} · Quyền {meeting.permission}</p></div><Status value={meeting.status}>{meeting.status}</Status><a className="btn btn-light" href={`/meetings/${meeting.id}`}>Mở bản ghi</a></article>; }
