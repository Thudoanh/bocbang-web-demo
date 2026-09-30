import { useRef, useState } from "react";
import { config } from "../app/config";
import { ApiError } from "../api/client";
import { meetingsApi } from "../api/endpoints";
import { Button, PageHeading } from "../components/ui";

const accepted = ["mp3", "wav", "m4a", "aac", "flac", "ogg", "opus", "webm", "mp4", "mov", "mkv", "avi", "mpeg", "mpg"];
export function UploadPage({ meetingId }: { meetingId: string }) {
  const input = useRef<HTMLInputElement>(null); const [file, setFile] = useState<File>(); const [message, setMessage] = useState(""); const [uploading, setUploading] = useState(false);
  function choose(next?: File) { if (!next) return; const extension = next.name.split(".").pop()?.toLowerCase(); if (!extension || !accepted.includes(extension)) return setMessage("Định dạng tệp chưa được hỗ trợ."); if (next.size > config.maxUploadBytes) return setMessage(`Tệp vượt quá giới hạn ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.`); setFile(next); setMessage(""); }
  async function upload() { if (!file) return; setUploading(true); setMessage(""); try { await meetingsApi.uploadMedia(meetingId, file); window.location.assign(`/meetings/${meetingId}`); } catch (cause) { setMessage((cause as ApiError).message); } finally { setUploading(false); } }
  return <><PageHeading eyebrow="NHẬP ÂM THANH" title="Tải tệp để bóc băng" description={`Tối đa ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB mỗi tệp, thời lượng tối đa ${config.maxMediaDurationSeconds / 3600} giờ.`} /><section className="upload-zone" onClick={() => input.current?.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); choose(e.dataTransfer.files[0]); }}><div className="upload-mark">↑</div><div><strong>{file?.name ?? "Kéo tệp vào đây hoặc chọn tệp"}</strong><p>Hỗ trợ {accepted.join(", ")}. Máy chủ sẽ kiểm tra tính hợp lệ và thời lượng.</p></div><Button>Chọn tệp</Button><input ref={input} hidden type="file" accept={accepted.map((x) => `.${x}`).join(",")} onChange={(e) => choose(e.target.files?.[0])} /></section>{file && <div className="file-card"><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(1)} MB</span></div>}{message && <div className="form-error">{message}</div>}<div className="form-actions"><a className="btn btn-light" href={`/meetings/${meetingId}`}>Quay lại</a><Button tone="dark" disabled={!file || uploading} onClick={() => void upload()}>{uploading ? "Đang tải lên…" : "Tải lên và xử lý"}</Button></div></>;
}
