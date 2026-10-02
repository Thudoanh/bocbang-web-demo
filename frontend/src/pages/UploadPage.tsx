import { useEffect, useRef, useState } from "react";
import { config } from "../app/config";
import { ApiError } from "../api/client";
import { meetingsApi } from "../api/endpoints";
import { useJobMonitor } from "../state/useJobMonitor";
import { Button, PageHeading, Status } from "../components/ui";

const accepted = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "webm", "mp4", "mov", "mkv", "avi", "mpeg", "mpg"];

export function UploadPage({ meetingId }: { meetingId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File>();
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const jobMonitor = useJobMonitor();

  useEffect(() => {
    if (jobMonitor.job?.status === "completed") window.setTimeout(() => window.location.assign(`/meetings/${meetingId}`), 500);
  }, [jobMonitor.job?.status, meetingId]);

  function choose(next?: File) {
    if (!next || uploading || jobMonitor.job) return;
    const extension = next.name.split(".").pop()?.toLowerCase();
    if (!extension || !accepted.includes(extension)) return setMessage("Định dạng tệp chưa được hỗ trợ.");
    if (next.size > config.maxUploadBytes) return setMessage(`Tệp vượt quá giới hạn ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`);
    setFile(next); setMessage("");
  }

  async function upload() {
    if (!file) return;
    setUploading(true); setMessage("");
    try { jobMonitor.track(await meetingsApi.uploadMedia(meetingId, file)); }
    catch (cause) { setMessage((cause as ApiError).message); }
    finally { setUploading(false); }
  }

  function retry() { jobMonitor.clear(); setMessage(""); }
  const job = jobMonitor.job;
  const terminal = job?.status === "completed" || job?.status === "failed";

  return <>
    <PageHeading eyebrow="NHẬP ÂM THANH" title="Tải tệp để bóc băng" description={`Tối đa ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB mỗi tệp, thời lượng tối đa ${config.maxMediaDurationSeconds / 3600} giờ.`} />
    <section className={`upload-zone ${job ? "is-disabled" : ""}`} onClick={() => !job && !uploading && input.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); choose(event.dataTransfer.files[0]); }}>
      <div className="upload-mark">↑</div><div><strong>{file?.name ?? "Kéo tệp vào đây hoặc chọn tệp"}</strong><p>Hỗ trợ {accepted.join(", ")}. Máy chủ sẽ kiểm tra tính hợp lệ và thời lượng.</p></div><Button disabled={Boolean(job) || uploading}>Chọn tệp</Button><input ref={input} hidden type="file" accept={accepted.map((extension) => `.${extension}`).join(",")} onChange={(event) => choose(event.target.files?.[0])} />
    </section>
    {file && <div className="file-card"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>}
    {job && <section className={`upload-job ${job.status}`}><div><strong>Đang xử lý bản ghi</strong><Status value={job.status}>{job.status}</Status></div><p>{job.status === "completed" ? "Đã tạo transcript. Đang mở kết quả…" : job.status === "failed" ? job.error?.message ?? "Xử lý tệp thất bại." : "Tệp đã được tải lên; hệ thống đang tạo transcript."}</p>{job.status !== "failed" && <div className="job-progress" aria-label={`Tiến độ ${job.progress ?? 0}%`}><i style={{ width: `${job.progress ?? 0}%` }} /></div>}{job.status === "failed" && <Button onClick={retry}>Chọn tệp khác</Button>}</section>}
    {message && <div className="form-error">{message}</div>}
    <div className="form-actions"><a className="btn btn-light" href={`/meetings/${meetingId}`}>Quay lại</a>{!terminal && <Button tone="dark" disabled={!file || uploading || Boolean(job)} onClick={() => void upload()}>{uploading ? "Đang tải lên…" : job ? "Đang xử lý…" : "Tải lên và xử lý"}</Button>}{job?.status === "failed" && <Button tone="dark" disabled={!file} onClick={() => void upload()}>Thử tải lại</Button>}</div>
  </>;
}
