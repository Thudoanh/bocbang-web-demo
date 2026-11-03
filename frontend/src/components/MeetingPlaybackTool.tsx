import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { meetingsApi, recordingApi } from "../api/endpoints";
import { MEETING_PLAYBACK_CHANGED, MEETING_PLAYBACK_SEEK, MEETING_PLAYBACK_TIME } from "../api/playbackEvents";
import { useAsync } from "../hooks/useAsync";
import { recordingLabel, recordingPollDelay } from "../utils/recordingPlayback";
import { useRecordingToolbarHost } from "./MeetingToolbarContext";
import { ToolbarTooltip } from "./ToolbarTooltip";
import { Button, Icon } from "./ui";

export function MeetingPlaybackTool({ meetingId }: { meetingId: string }) {
  const host = useRecordingToolbarHost();
  const query = useAsync((signal) => recordingApi.latest(meetingId, signal), [meetingId]);
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [source, setSource] = useState("");
  const [speed, setSpeed] = useState(1);
  const [sourceRevision, setSourceRevision] = useState(0);
  const audio = useRef<HTMLAudioElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const seek = useRef(0);
  const playAfterLoad = useRef(false);
  const expires = useRef(0);
  const refreshAttempts = useRef(0);
  const media = query.data?.media;
  const ready = query.data?.status === "ready" && Boolean(media);
  const disabled = !query.error && query.data?.status === "not_completed";
  const label = query.error ? "Nghe lại — Không đọc được trạng thái, bấm để thử lại" : recordingLabel(query.data);

  useEffect(() => { if (open) panelRef.current?.querySelector<HTMLElement>("button")?.focus(); }, [open]);

  useEffect(() => {
    if (query.loading) return;
    const delay = recordingPollDelay(query.data, Boolean(query.error));
    if (!delay) return;
    const timer = window.setTimeout(() => { void query.reload(); }, delay);
    return () => window.clearTimeout(timer);
  }, [query.data, query.error, query.loading, query.reload]);

  useEffect(() => {
    const refresh = (event?: Event) => {
      if (!event || event.type === "focus" || (event as CustomEvent).detail?.meetingId === meetingId) void query.reload();
    };
    const requestSeek = (event: Event) => {
      const detail = (event as CustomEvent<{ meetingId: string; milliseconds: number }>).detail;
      if (detail?.meetingId !== meetingId || !Number.isFinite(detail.milliseconds)) return;
      seek.current = Math.max(0, detail.milliseconds / 1000);
      playAfterLoad.current = true;
      setHasOpened(true); setOpen(true);
      if (audio.current && source) {
        playAfterLoad.current = false;
        audio.current.currentTime = Math.min(seek.current, audio.current.duration || seek.current);
        void audio.current.play().catch(() => setError("Bấm Phát trong trình nghe để bắt đầu."));
      }
    };
    window.addEventListener(MEETING_PLAYBACK_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener(MEETING_PLAYBACK_SEEK, requestSeek);
    return () => {
      window.removeEventListener(MEETING_PLAYBACK_CHANGED, refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(MEETING_PLAYBACK_SEEK, requestSeek);
    };
  }, [meetingId, query.reload, source]);

  useEffect(() => {
    if (!hasOpened || !ready || !media) return;
    let cancelled = false;
    setSource(""); setError("");
    void meetingsApi.playbackUrl(meetingId, media.id).then((result) => {
      if (cancelled) return;
      expires.current = Date.now() + result.expires_in_seconds * 1000;
      setSource(result.url);
    }).catch((cause: Error) => { if (!cancelled) setError(cause.message); });
    return () => { cancelled = true; };
  }, [meetingId, media?.id, hasOpened, ready, sourceRevision]);

  const emitTime = useCallback((milliseconds: number | null) => {
    window.dispatchEvent(new CustomEvent(MEETING_PLAYBACK_TIME, { detail: { meetingId, milliseconds } }));
  }, [meetingId]);
  useEffect(() => () => emitTime(null), [emitTime]);

  function close() {
    audio.current?.pause(); playAfterLoad.current = false; setOpen(false); trigger.current?.focus();
  }
  function refreshSource(play = false) {
    seek.current = audio.current?.currentTime ?? seek.current;
    playAfterLoad.current = play;
    setSourceRevision((value) => value + 1);
  }
  async function prepare() {
    if (busy) return;
    setBusy(true); setError("");
    try { query.setData(await recordingApi.prepare(meetingId)); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  }
  async function download() {
    if (!media || busy) return;
    setBusy(true); setError("");
    let url = "";
    try {
      const blob = await recordingApi.download(meetingId, media.id);
      url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = media.original_filename;
      document.body.append(link); link.click(); link.remove();
    } catch (cause) { setError((cause as Error).message); }
    finally { if (url) window.setTimeout(() => URL.revokeObjectURL(url), 1000); setBusy(false); }
  }

  const panel = hasOpened && <section ref={panelRef} id={`meeting-playback-${meetingId}`} hidden={!open} className="meeting-playback-panel" aria-label="Nghe lại băng ghi âm" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
    <div className="meeting-playback-heading"><strong>Nghe lại băng</strong><button type="button" className="playback-close" aria-label="Đóng trình nghe lại" onClick={close}><Icon name="close" /></button></div>
    {query.error && <div className="form-error" role="alert">{query.error.message} <Button onClick={() => { void query.reload(); }}>Thử lại</Button></div>}
    {error && <div className="form-error" role="alert">{error}</div>}
    {!query.data && !query.error && <p role="status">Đang kiểm tra băng ghi âm…</p>}
    {query.data?.status === "pending" && <p role="status">Đang chuẩn bị bản ghi… {query.data.job?.status === "retrying" ? "Máy chủ đang thử lại." : "Bạn có thể tiếp tục đọc transcript."}</p>}
    {query.data?.status === "not_completed" && <p>Kết thúc cuộc họp để chuẩn bị băng nghe lại.</p>}
    {query.data?.status === "failed" && <p role="alert">{query.data.job?.error?.message ?? "Không thể chuẩn bị băng ghi âm."}</p>}
    {query.data?.status === "deleted" && <p>Băng ghi âm đã được xóa.</p>}
    {query.data?.status === "unavailable" && <p>{query.data.can_prepare ? "Có âm thanh đã lưu. Bấm Chuẩn bị băng để khôi phục cuộc họp cũ." : "Không có âm thanh gốc để nghe lại. Không thể tạo lại băng từ transcript."}</p>}
    {query.data?.can_prepare && <Button disabled={busy} onClick={() => { void prepare(); }}>{busy ? "Đang gửi…" : query.data.status === "failed" ? "Thử chuẩn bị lại" : "Chuẩn bị băng"}</Button>}
    {query.data?.warning && <p className="playback-warning" role="status">{query.data.warning}</p>}
    {ready && <>
      {!source && !error && <p role="status">Đang mở âm thanh…</p>}
      {source && <audio ref={audio} controls controlsList="nodownload noplaybackrate" preload="metadata" src={source}
        onLoadedMetadata={() => {
          const element = audio.current; if (!element) return;
          element.playbackRate = speed; element.currentTime = Math.min(seek.current, element.duration || seek.current);
          if (playAfterLoad.current) { playAfterLoad.current = false; void element.play().catch(() => setError("Bấm Phát trong trình nghe để bắt đầu.")); }
        }}
        onTimeUpdate={() => { if (audio.current) { seek.current = audio.current.currentTime; emitTime(seek.current * 1000); } }}
        onSeeking={() => { if (expires.current <= Date.now() && audio.current) { audio.current.pause(); refreshSource(false); } }}
        onPlay={() => { if (expires.current <= Date.now()) { audio.current?.pause(); refreshSource(true); } }}
        onEnded={() => emitTime(null)}
        onError={() => { if (refreshAttempts.current++ < 1) refreshSource(false); else setError("Không thể tải âm thanh. Bấm Tải lại âm thanh để thử lại."); }}
      >Trình duyệt không hỗ trợ phát âm thanh.</audio>}
      <div className="meeting-playback-actions">
        <label>Tốc độ <select value={speed} onChange={(event) => { const next = Number(event.target.value); setSpeed(next); if (audio.current) audio.current.playbackRate = next; }}>{[0.75, 1, 1.25, 1.5, 2].map((value) => <option key={value} value={value}>{value}×</option>)}</select></label>
        <Button disabled={busy} onClick={() => { void download(); }}><Icon name="export" />{busy ? "Đang tải…" : "Tải băng xuống"}</Button>
        {error && <Button onClick={() => { refreshAttempts.current = 0; refreshSource(false); }}>Tải lại âm thanh</Button>}
      </div>
    </>}
  </section>;

  return <>
    <ToolbarTooltip label={label} disabled={disabled}><button ref={trigger} type="button" disabled={disabled} aria-label="Nghe lại" aria-expanded={open} aria-controls={hasOpened ? `meeting-playback-${meetingId}` : undefined} className={open ? "selected" : ""} onClick={() => { if (open) close(); else { setHasOpened(true); setOpen(true); } }}>
      <Icon name="volume" />{query.data?.status === "pending" && <span className="playback-pending" aria-hidden="true" />}
    </button></ToolbarTooltip>
    {host && panel && createPortal(panel, host)}
  </>;
}
