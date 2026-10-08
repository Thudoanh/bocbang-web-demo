import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { MeetingSocket, type RealtimeEvent } from "../realtime/meetingSocket";
import { MicrophonePcmCapture } from "../realtime/microphonePcm";
import { capabilitiesApi, meetingsApi, type TranscriptMutation } from "../api/endpoints";
import { ApiError } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { can } from "../utils/permissions";
import { formatTimestampInput, parseTimestampInput } from "../utils/time";
import type { Comment, Segment } from "../types/domain";
import { Button, Empty, Failure, Loading, PageHeading, Status } from "../components/ui";

type SegmentDraft = { text: string; startTime: string; endTime: string; speakerId: string };
type AudioPlayerHandle = { seek: (milliseconds: number) => void };
type MeetingTab = "info" | "comments" | "versions";
type RealtimeTranslation = { text: string; sourceLanguage: string; targetLanguage: string };

export function MeetingPage({ meetingId }: { meetingId: string }) {
  const meeting = useAsync(() => meetingsApi.get(meetingId), [meetingId]);
  const transcript = useAsync(() => meetingsApi.transcript(meetingId), [meetingId]);
  const media = useAsync(() => meetingsApi.media(meetingId), [meetingId]);
  const speakers = useAsync(() => meetingsApi.speakers(meetingId), [meetingId]);
  const capabilities = useAsync(capabilitiesApi.get, []);
  const comments = useAsync(() => meetingsApi.comments(meetingId), [meetingId]);
  const versions = useAsync(() => meetingsApi.versions(meetingId), [meetingId]);
  const [editing, setEditing] = useState<Segment>();
  const [draft, setDraft] = useState<SegmentDraft>({ text: "", startTime: "00:00", endTime: "00:00", speakerId: "" });
  const [notice, setNotice] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Segment>();
  const [pendingSplit, setPendingSplit] = useState<Segment>();
  const [mergeFirst, setMergeFirst] = useState<Segment>();
  const [pendingMerge, setPendingMerge] = useState<{ first: Segment; second: Segment }>();
  const [activeSegmentId, setActiveSegmentId] = useState<string>();
  const [activeTab, setActiveTab] = useState<MeetingTab>("info");
  const [realtimeTranslations, setRealtimeTranslations] = useState<Record<string, RealtimeTranslation>>({});
  const [showRealtimeTranslations, setShowRealtimeTranslations] = useState(false);
  const player = useRef<AudioPlayerHandle>(null);

  useEffect(() => { if (editing) setDraft({ text: editing.text, startTime: formatTimestampInput(editing.start_ms), endTime: formatTimestampInput(editing.end_ms), speakerId: editing.speaker_id ?? "" }); }, [editing]);
  useEffect(() => { if (!activeSegmentId || editing) return; document.getElementById(`segment-${activeSegmentId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [activeSegmentId, editing]);
  function applyMutation(result: TranscriptMutation, removedId?: string) {
    transcript.setData((current) => {
      if (!current) return current;
      return { ...current, version_id: result.version_id, version_no: result.version_no, segments: removedId ? current.segments.filter((segment) => segment.logical_segment_id !== removedId) : current.segments.map((segment) => segment.logical_segment_id === result.segment?.logical_segment_id ? result.segment : segment) };
    });
    void versions.reload();
  }
  async function save() {
    if (!editing) return;
    const startMs = parseTimestampInput(draft.startTime); const endMs = parseTimestampInput(draft.endTime);
    if (!draft.text.trim() || startMs === undefined || endMs === undefined || endMs <= startMs) return setNotice("Nháº­p thá»i gian theo mm:ss hoáº·c hh:mm:ss; má»‘c káº¿t thÃºc pháº£i lá»›n hÆ¡n má»‘c báº¯t Ä‘áº§u.");
    try {
      const changedSpeaker = draft.speakerId || null;
      const segmentChanged = editing.text !== draft.text || editing.start_ms !== startMs || editing.end_ms !== endMs;
      if (segmentChanged) await meetingsApi.saveSegment(editing.logical_segment_id, { text: draft.text.trim(), start_ms: startMs, end_ms: endMs });
      if ((editing.speaker_id ?? null) !== changedSpeaker) await meetingsApi.setSegmentSpeaker(editing.logical_segment_id, changedSpeaker);
      await transcript.reload(); await versions.reload(); setEditing(undefined); setNotice("ÄÃ£ lÆ°u thay Ä‘á»•i vÃ  táº¡o phiÃªn báº£n transcript má»›i.");
    } catch (cause) { setNotice(meetingErrorMessage(cause)); }
  }
  async function mutate(action: () => Promise<TranscriptMutation>, success: string, removedId?: string) {
    try { const result = await action(); if (removedId) applyMutation(result, removedId); else { await transcript.reload(); await versions.reload(); } setNotice(success); }
    catch (cause) { setNotice(meetingErrorMessage(cause)); }
  }
  function merge(segment: Segment) {
    if (!mergeFirst) return setMergeFirst(segment);
    if (mergeFirst.logical_segment_id === segment.logical_segment_id) return setMergeFirst(undefined);
    const segments = transcript.data?.segments ?? [];
    const firstIndex = segments.findIndex((item) => item.logical_segment_id === mergeFirst.logical_segment_id);
    const secondIndex = segments.findIndex((item) => item.logical_segment_id === segment.logical_segment_id);
    if (Math.abs(firstIndex - secondIndex) !== 1) { setNotice("Chá»‰ cÃ³ thá»ƒ gá»™p hai Ä‘oáº¡n liá»n ká»."); setMergeFirst(undefined); return; }
    const [first, second] = firstIndex < secondIndex ? [mergeFirst, segment] : [segment, mergeFirst];
    setMergeFirst(undefined); setPendingMerge({ first, second });
  }
  if (meeting.loading) return <Loading />;
  if (meeting.error || !meeting.data) return <Failure error={meeting.error ?? new Error("KhÃ´ng tÃ¬m tháº¥y cuá»™c há»p.")} retry={meeting.reload} />;
  const editable = can(meeting.data.permission, "edit"); const owner = meeting.data.permission === "owner";
  const realtimeTarget = meeting.data.language_mode === "vi" ? "en" : meeting.data.language_mode === "en" ? "vi" : undefined;
  const realtimeTranslationSupported = Boolean(realtimeTarget && capabilities.data?.translation.language_pairs?.some(([source, target]) => source === meeting.data?.language_mode && target === realtimeTarget));
  const displayedSegments = transcript.data?.segments.slice().reverse() ?? [];
  return <>
    <PageHeading eyebrow="Báº¢N GHI" title={meeting.data.title} description={`${meeting.data.language_mode.toUpperCase()} Â· ${meeting.data.source_type === "realtime" ? "Ghi Ã¢m" : "Tá»‡p"}`} actions={<>{meeting.data.source_type === "upload" && <a className="btn btn-light" href={`/meetings/${meetingId}/upload`}>Táº£i tá»‡p</a>}{owner && <Button tone="dark" onClick={() => setShareOpen(true)}>Chia sáº»</Button>}</>} />
    {notice && <div className="notice">{notice}</div>}
    <div className="meeting-layout"><section>
      {editable && meeting.data.source_type === "realtime" && meeting.data.status !== "completed" && capabilities.data?.stt.streaming && <RecordingPanel meetingId={meetingId} targetLanguage={realtimeTranslationSupported ? realtimeTarget : undefined} translationVisible={showRealtimeTranslations} onTranslationVisibleChange={setShowRealtimeTranslations} onTranslation={(logicalSegmentId, translation) => setRealtimeTranslations((current) => ({ ...current, [logicalSegmentId]: translation }))} onFinal={() => void transcript.reload()} hasStartedBefore={transcript.data?.segments !== undefined && transcript.data.segments.length > 0} />}
      {media.data?.[0] && <MediaPlayer ref={player} meetingId={meetingId} mediaId={media.data[0].id} filename={media.data[0].original_filename} segments={transcript.data?.segments ?? []} onActiveSegment={setActiveSegmentId} />}
      <div className="section-title"><h2>Ná»™i dung</h2>{transcript.data && <Status>v{transcript.data.version_no}</Status>}</div>
      {mergeFirst && <div className="notice">Chá»n má»™t Ä‘oáº¡n liá»n ká» Ä‘á»ƒ gá»™p vá»›i Ä‘oáº¡n Ä‘Ã£ chá»n, hoáº·c báº¥m â€œGá»™pâ€ láº§n ná»¯a Ä‘á»ƒ há»§y.</div>}
      {transcript.loading && <Loading label="Äang táº£i transcriptâ€¦" />}{transcript.error && <TranscriptState error={transcript.error} sourceType={meeting.data.source_type} uploadHref={`/meetings/${meetingId}/upload`} />}
      {displayedSegments.length ? <div className="transcript-list">{displayedSegments.map((segment) => <article className={`segment ${activeSegmentId === segment.logical_segment_id ? "is-playing" : ""}`} id={`segment-${segment.logical_segment_id}`} key={segment.logical_segment_id}>
        <div className="segment-meta"><strong>{speakers.data?.find((speaker) => speaker.id === segment.speaker_id)?.name ?? "ChÆ°a xÃ¡c Ä‘á»‹nh"}</strong><button className="segment-time" type="button" onClick={() => player.current?.seek(segment.start_ms)}>{formatTime(segment.start_ms)} â€“ {formatTime(segment.end_ms)}</button>{segment.confidence !== undefined && <small>{Math.round(segment.confidence * 100)}% tin cáº­y</small>}</div>
        {editing?.logical_segment_id === segment.logical_segment_id ? <div className="editor"><label>Ná»™i dung<textarea value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} /></label><div className="segment-time-fields"><label>Báº¯t Ä‘áº§u (mm:ss)<input inputMode="numeric" placeholder="01:15" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} /></label><label>Káº¿t thÃºc (mm:ss)<input inputMode="numeric" placeholder="02:30" value={draft.endTime} onChange={(event) => setDraft({ ...draft, endTime: event.target.value })} /></label></div><label>NgÆ°á»i nÃ³i<select value={draft.speakerId} onChange={(event) => setDraft({ ...draft, speakerId: event.target.value })}><option value="">ChÆ°a xÃ¡c Ä‘á»‹nh</option>{speakers.data?.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}</select></label><div className="form-actions"><Button onClick={() => setEditing(undefined)}>Há»§y</Button><Button tone="dark" onClick={() => void save()}>LÆ°u</Button></div></div> : <div className="segment-content"><p>{segment.text}</p>{showRealtimeTranslations && realtimeTranslations[segment.logical_segment_id] && <div className="realtime-translation"><small>Báº¢N Dá»ŠCH Â· {realtimeTranslations[segment.logical_segment_id].targetLanguage.toUpperCase()}</small><p>{realtimeTranslations[segment.logical_segment_id].text}</p></div>}{editable && <div className="inline-actions"><Button onClick={() => setEditing(segment)}>Sá»­a</Button><Button onClick={() => setPendingSplit(segment)}>TÃ¡ch</Button><Button className={mergeFirst?.logical_segment_id === segment.logical_segment_id ? "is-selected" : ""} onClick={() => merge(segment)}>{mergeFirst?.logical_segment_id === segment.logical_segment_id ? "Há»§y" : "Gá»™p"}</Button><Button tone="danger" onClick={() => setPendingDelete(segment)}>XÃ³a</Button></div>}</div>}
      </article>)}</div> : null}
    </section><MeetingSidePanel activeTab={activeTab} setActiveTab={setActiveTab} meeting={meeting.data} segmentCount={transcript.data?.segments.length ?? 0} speakerCount={speakers.data?.length ?? 0} meetingId={meetingId} canComment={can(meeting.data.permission, "comment")} comments={comments} versions={versions} /></div>
    {shareOpen && <ShareDialog meetingId={meetingId} close={() => setShareOpen(false)} />}{pendingSplit && <SplitDialog segment={pendingSplit} close={() => setPendingSplit(undefined)} confirm={(splitAt) => { const segment = pendingSplit; setPendingSplit(undefined); void mutate(() => meetingsApi.splitSegment(segment.logical_segment_id, splitAt), "ÄÃ£ tÃ¡ch Ä‘oáº¡n vÃ  táº¡o phiÃªn báº£n má»›i."); }} />}{pendingMerge && <ConfirmDialog title="Gá»™p hai Ä‘oáº¡n transcript?" detail="Hai Ä‘oáº¡n liá»n ká» sáº½ Ä‘Æ°á»£c gá»™p thÃ nh má»™t Ä‘oáº¡n vÃ  táº¡o phiÃªn báº£n transcript má»›i." confirmLabel="Gá»™p Ä‘oáº¡n" close={() => setPendingMerge(undefined)} confirm={() => { const { first, second } = pendingMerge; setPendingMerge(undefined); void mutate(() => meetingsApi.mergeSegments(first.logical_segment_id, second.logical_segment_id), "ÄÃ£ gá»™p hai Ä‘oáº¡n vÃ  táº¡o phiÃªn báº£n má»›i."); }} />}{pendingDelete && <ConfirmDialog title="XÃ³a Ä‘oáº¡n transcript?" detail="Äoáº¡n Ä‘Ã£ xÃ³a sáº½ khÃ´ng cÃ²n trong phiÃªn báº£n transcript hiá»‡n hÃ nh." confirmLabel="XÃ³a Ä‘oáº¡n" close={() => setPendingDelete(undefined)} confirm={() => { const segment = pendingDelete; setPendingDelete(undefined); void mutate(() => meetingsApi.deleteSegment(segment.logical_segment_id), "ÄÃ£ xÃ³a Ä‘oáº¡n vÃ  táº¡o phiÃªn báº£n má»›i.", segment.logical_segment_id); }} />}
  </>;
}

function TranscriptState({ error, sourceType, uploadHref }: { error: Error; sourceType: "realtime" | "upload"; uploadHref: string }) { const api = error as ApiError; const missing = api.status === 404; return <Empty title={missing ? "ChÆ°a cÃ³ transcript" : "Transcript chÆ°a táº£i Ä‘Æ°á»£c"} detail={missing ? sourceType === "upload" ? "Táº£i tá»‡p Ã¢m thanh Ä‘á»ƒ táº¡o transcript tá»« backend." : "Báº¯t Ä‘áº§u ghi Ã¢m Ä‘á»ƒ táº¡o transcript trá»±c tiáº¿p." : error.message} action={missing && sourceType === "upload" ? <a className="btn btn-dark" href={uploadHref}>Táº£i tá»‡p Ã¢m thanh</a> : undefined} />; }
function MeetingSidePanel({ activeTab, setActiveTab, meeting, segmentCount, speakerCount, meetingId, canComment, comments, versions }: { activeTab: MeetingTab; setActiveTab: (tab: MeetingTab) => void; meeting: { status: string; language_mode: string; duration_ms?: number }; segmentCount: number; speakerCount: number; meetingId: string; canComment: boolean; comments: { data?: Comment[]; setData: React.Dispatch<React.SetStateAction<Comment[] | undefined>> }; versions: { data?: Array<{ id: string; version_no: number; source: string; created_at: string }>; loading: boolean; error?: Error } }) {
  const tabs: Array<[MeetingTab, string]> = [["info", "ThÃ´ng tin"], ["comments", "BÃ¬nh luáº­n"], ["versions", "PhiÃªn báº£n"]];
  return <aside className="meeting-side"><div className="meeting-tabs" role="tablist" aria-label="Chi tiáº¿t cuá»™c há»p">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>{label}</button>)}</div><div className="meeting-tab-content" role="tabpanel">{activeTab === "info" && <MeetingContext meeting={meeting} segmentCount={segmentCount} speakerCount={speakerCount} />}{activeTab === "comments" && <CommentsPanel meetingId={meetingId} canComment={canComment} comments={comments} />}{activeTab === "versions" && <section className="panel"><h2>PhiÃªn báº£n</h2><VersionList versions={versions} /></section>}</div></aside>;
}
const MediaPlayer = forwardRef<AudioPlayerHandle, { meetingId: string; mediaId: string; filename: string; segments: Segment[]; onActiveSegment: (id?: string) => void }>(function MediaPlayer({ meetingId, mediaId, filename, segments, onActiveSegment }, ref) {
  const audio = useRef<HTMLAudioElement>(null); const [source, setSource] = useState(""); const [error, setError] = useState(""); const [speed, setSpeed] = useState(1);
  useImperativeHandle(ref, () => ({ seek(milliseconds) { const element = audio.current; if (!element) return; element.currentTime = milliseconds / 1000; void element.play(); } }), []);
  useEffect(() => { let active = true; void meetingsApi.playbackUrl(meetingId, mediaId).then((result) => { if (active) setSource(result.url); }).catch((cause: Error) => active && setError(cause.message)); return () => { active = false; }; }, [meetingId, mediaId]);
  function syncTranscript() { const milliseconds = (audio.current?.currentTime ?? 0) * 1000; const segment = segments.find((item) => item.start_ms <= milliseconds && milliseconds < item.end_ms); onActiveSegment(segment?.logical_segment_id); }
  function changeSpeed(next: number) { setSpeed(next); if (audio.current) audio.current.playbackRate = next; }
  return <section className="player"><div className="player-heading"><strong>Nghe láº¡i bÄƒng Â· {filename}</strong>{source && <label>Tá»‘c Ä‘á»™ <select value={speed} onChange={(event) => changeSpeed(Number(event.target.value))}><option value={0.75}>0.75Ã—</option><option value={1}>1Ã—</option><option value={1.25}>1.25Ã—</option><option value={1.5}>1.5Ã—</option><option value={2}>2Ã—</option></select></label>}</div>{error ? <div className="form-error">{error}</div> : source ? <audio ref={audio} controls preload="metadata" src={source} onTimeUpdate={syncTranscript} onSeeking={syncTranscript} onEnded={() => onActiveSegment(undefined)}>TrÃ¬nh duyá»‡t khÃ´ng há»— trá»£ phÃ¡t Ã¢m thanh.</audio> : <Loading label="Äang chuáº©n bá»‹ audioâ€¦" />}</section>;
});
function MeetingContext({ meeting, segmentCount, speakerCount }: { meeting: { status: string; language_mode: string; duration_ms?: number }; segmentCount: number; speakerCount: number }) { return <section className="panel meeting-context"><h2>ThÃ´ng tin phiÃªn há»p</h2><dl><div><dt>Tráº¡ng thÃ¡i</dt><dd><Status value={meeting.status}>{meeting.status}</Status></dd></div><div><dt>NgÃ´n ngá»¯</dt><dd>{meeting.language_mode.toUpperCase()}</dd></div><div><dt>NgÆ°á»i nÃ³i</dt><dd>{speakerCount || "ChÆ°a xÃ¡c Ä‘á»‹nh"}</dd></div><div><dt>PhÃ¢n Ä‘oáº¡n</dt><dd>{segmentCount}</dd></div></dl></section>; }
function VersionList({ versions }: { versions: { data?: Array<{ id: string; version_no: number; source: string; created_at: string }>; loading: boolean; error?: Error } }) { if (versions.loading) return <Loading />; if (versions.error) return <p>KhÃ´ng táº£i Ä‘Æ°á»£c lá»‹ch sá»­.</p>; if (!versions.data?.length) return <p>ChÆ°a cÃ³ phiÃªn báº£n transcript.</p>; return <ol className="versions">{versions.data.map((version) => <li key={version.id}>v{version.version_no} Â· {version.source} Â· {new Date(version.created_at).toLocaleString("vi-VN")}</li>)}</ol>; }
function ConfirmDialog({ title, detail, confirmLabel, close, confirm }: { title: string; detail: string; confirmLabel: string; close: () => void; confirm: () => void }) { return <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{detail}</p><div className="dialog-actions"><Button onClick={close}>Há»§y</Button><Button tone="danger" onClick={confirm}>{confirmLabel}</Button></div></section></div>; }
function SplitDialog({ segment, close, confirm }: { segment: Segment; close: () => void; confirm: (splitAt: number) => void }) { const [splitAt, setSplitAt] = useState(formatTimestampInput(Math.floor((segment.start_ms + segment.end_ms) / 2))); const splitAtMs = parseTimestampInput(splitAt); const valid = splitAtMs !== undefined && splitAtMs > segment.start_ms && splitAtMs < segment.end_ms; return <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="split-title"><h2 id="split-title">TÃ¡ch Ä‘oáº¡n transcript</h2><p>Chá»n má»‘c náº±m giá»¯a {formatTime(segment.start_ms)} vÃ  {formatTime(segment.end_ms)}. Ná»™i dung sáº½ Ä‘Æ°á»£c chia thÃ nh hai Ä‘oáº¡n vÃ  táº¡o phiÃªn báº£n má»›i.</p><label>Má»‘c tÃ¡ch (mm:ss)<input inputMode="numeric" placeholder="01:15" value={splitAt} onChange={(event) => setSplitAt(event.target.value)} /></label>{!valid && <div className="form-error">Nháº­p mm:ss hoáº·c hh:mm:ss; má»‘c tÃ¡ch pháº£i náº±m bÃªn trong Ä‘oáº¡n hiá»‡n táº¡i.</div>}<div className="dialog-actions"><Button onClick={close}>Há»§y</Button><Button tone="dark" disabled={!valid} onClick={() => confirm(splitAtMs!)}>TÃ¡ch Ä‘oáº¡n</Button></div></section></div>; }
function ShareDialog({ meetingId, close }: { meetingId: string; close: () => void }) { const [email, setEmail] = useState(""); const [permission, setPermission] = useState<"read" | "comment" | "edit">("read"); const [message, setMessage] = useState(""); async function submit(event: React.FormEvent) { event.preventDefault(); try { await meetingsApi.addMember(meetingId, email, permission); setMessage("ÄÃ£ má»i cá»™ng tÃ¡c viÃªn."); } catch (cause) { setMessage((cause as Error).message); } } return <div className="dialog-backdrop"><form className="dialog" onSubmit={submit}><button className="close" onClick={close} type="button">Ã—</button><h2>Chia sáº» cuá»™c há»p</h2><p>Chá»‰ owner cÃ³ thá»ƒ quáº£n lÃ½ quyá»n truy cáº­p.</p><label>Email<input type="email" value={email} required onChange={(event) => setEmail(event.target.value)} /></label><label>Quyá»n<select value={permission} onChange={(event) => setPermission(event.target.value as typeof permission)}><option value="read">Xem</option><option value="comment">BÃ¬nh luáº­n</option><option value="edit">Chá»‰nh sá»­a</option></select></label>{message && <div className="form-error">{message}</div>}<Button tone="dark">Gá»­i lá»i má»i</Button></form></div>; }
function CommentsPanel({ meetingId, canComment, comments }: { meetingId: string; canComment: boolean; comments: { data?: Comment[]; setData: React.Dispatch<React.SetStateAction<Comment[] | undefined>> } }) { const [body, setBody] = useState(""); const [editing, setEditing] = useState<Comment>(); const [error, setError] = useState(""); async function submit(event: React.FormEvent) { event.preventDefault(); try { const comment = await meetingsApi.addComment(meetingId, body); comments.setData((items) => [...(items ?? []), comment]); setBody(""); setError(""); } catch (cause) { setError((cause as Error).message); } } async function update() { if (!editing) return; try { const comment = await meetingsApi.updateComment(editing.id, editing.body); comments.setData((items) => items?.map((item) => item.id === comment.id ? comment : item)); setEditing(undefined); setError(""); } catch (cause) { setError((cause as Error).message); } } async function remove(id: string) { try { await meetingsApi.deleteComment(id); comments.setData((items) => items?.filter((item) => item.id !== id)); setError(""); } catch (cause) { setError((cause as Error).message); } } return <section className="panel"><h2>BÃ¬nh luáº­n</h2>{comments.data?.map((comment) => <div className="speaker" key={comment.id}>{editing?.id === comment.id ? <><textarea aria-label="Sá»­a bÃ¬nh luáº­n" value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} /><Button onClick={() => void update()}>LÆ°u</Button><Button onClick={() => setEditing(undefined)}>Há»§y</Button></> : <><strong>{comment.body}</strong><span>{new Date(comment.created_at).toLocaleString("vi-VN")}</span>{canComment && <><Button onClick={() => setEditing(comment)}>Sá»­a</Button><Button tone="danger" onClick={() => void remove(comment.id)}>XÃ³a</Button></>}</>}</div>)}{canComment ? <form className="comments-form" onSubmit={submit}><textarea aria-label="BÃ¬nh luáº­n" value={body} required onChange={(event) => setBody(event.target.value)} /><Button tone="dark">Gá»­i bÃ¬nh luáº­n</Button>{error && <div className="form-error">{error}</div>}</form> : <p>Báº¡n chá»‰ cÃ³ quyá»n xem bÃ¬nh luáº­n.</p>}</section>; }
function RecordingPanel({ meetingId, targetLanguage, translationVisible, onTranslationVisibleChange, onTranslation, onFinal, hasStartedBefore }: { meetingId: string; targetLanguage?: string; translationVisible: boolean; onTranslationVisibleChange: (visible: boolean) => void; onTranslation: (logicalSegmentId: string, translation: RealtimeTranslation) => void; onFinal: () => void; hasStartedBefore?: boolean }) {
  const { accessToken } = useAuth();
  const socket = useRef<MeetingSocket | undefined>(undefined);
  const capture = useRef<MicrophonePcmCapture | undefined>(undefined);
  const startedAt = useRef<number | undefined>(undefined);
  const elapsedBeforePause = useRef(0);
  const translationEnabled = useRef(false);
  const finalSegmentIds = useRef(new Set<string>());
  const translatedSegmentIds = useRef(new Set<string>());
  const [status, setStatus] = useState("Sáºµn sÃ ng ghi Ã¢m");
  const [translationStatus, setTranslationStatus] = useState("");
  const [partial, setPartial] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "recording" | "paused" | "stopping" | "failed">("idle");
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => () => { void stop(true); }, []);
  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => setElapsed(elapsedBeforePause.current + Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [state]);

  function missingTranslationIds() {
    return [...finalSegmentIds.current].filter((id) => !translatedSegmentIds.current.has(id));
  }

  async function releaseCapture(flush: boolean) {
    const current = capture.current;
    capture.current = undefined;
    if (current) await current.stop(flush);
  }

  function event(event: RealtimeEvent) {
    if (event.type === "session.ready") {
      void capture.current?.resume();
      setState("recording");
      setStatus("Äang ghi Ã¢m vÃ  nháº­n transcript trá»±c tiáº¿p.");
      startedAt.current = Date.now();
      if (translationEnabled.current && targetLanguage) {
        socket.current?.enableTranslation(targetLanguage, missingTranslationIds());
      }
    }
    if (event.type === "transcript.partial") setPartial(event.text);
    if (event.type === "transcript.final") {
      setPartial("");
      finalSegmentIds.current.add(event.logical_segment_id);
      onFinal();
    }
    if (event.type === "transcript.speaker_revision") onFinal();
    if (event.type === "translation.status") {
      setTranslationStatus(event.enabled ? "Äang dá»‹ch trá»±c tiáº¿p cÃ¡c Ä‘oáº¡n Ä‘Ã£ Ä‘Æ°á»£c xÃ¡c nháº­n." : "");
    }
    if (event.type === "translation.final") {
      translatedSegmentIds.current.add(event.logical_segment_id);
      onTranslation(event.logical_segment_id, {
        text: event.text,
        sourceLanguage: event.source_language,
        targetLanguage: event.target_language,
      });
      setTranslationStatus("ÄÃ£ cáº­p nháº­t báº£n dá»‹ch realtime.");
    }
    if (event.type === "translation.error") {
      setTranslationStatus(`Dá»‹ch realtime: ${event.message}`);
    }
    if (event.type === "meeting.status") {
      setState("stopping");
      setStatus("ÄÃ£ káº¿t thÃºc ghi Ã¢m.");
    }
    if (event.type === "error") {
      setStatus(event.message || "Lá»—i realtime.");
      if (event.retryable === false) {
        setState("failed");
        void releaseCapture(false);
      }
    }
  }

  async function start() {
    if (!accessToken) return;
    try {
      await releaseCapture(false);
      socket.current?.close();
      setState("connecting");
      setStatus("Äang xin quyá»n microphone vÃ  káº¿t ná»‘iâ€¦");
      capture.current = await MicrophonePcmCapture.open((chunk) => socket.current?.sendAudio(chunk));
      socket.current = new MeetingSocket(meetingId, accessToken, event, (next) => {
        if (next === "reconnecting") {
          void capture.current?.pause();
          setStatus("Máº¥t káº¿t ná»‘i, Ä‘ang thá»­ káº¿t ná»‘i láº¡iâ€¦");
        }
        if (next === "closed") setState((current) => current === "stopping" ? current : "failed");
      });
      socket.current.connect();
    } catch (cause) {
      await releaseCapture(false);
      setState("failed");
      setStatus(cause instanceof DOMException && cause.name === "NotAllowedError" ? "Cáº§n cáº¥p quyá»n microphone Ä‘á»ƒ ghi Ã¢m." : (cause as Error).message);
    }
  }

  function toggleTranslation() {
    if (!targetLanguage) return;
    if (translationVisible) {
      translationEnabled.current = false;
      onTranslationVisibleChange(false);
      setTranslationStatus("");
      socket.current?.disableTranslation();
      return;
    }
    translationEnabled.current = true;
    onTranslationVisibleChange(true);
    setTranslationStatus("Äang báº­t dá»‹ch realtimeâ€¦");
    socket.current?.enableTranslation(targetLanguage, missingTranslationIds());
  }

  async function pause() {
    await capture.current?.pause();
    socket.current?.command("recording.pause");
    elapsedBeforePause.current = elapsed;
    setState("paused");
    setStatus("ÄÃ£ táº¡m dá»«ng ghi Ã¢m.");
  }

  async function resume() {
    socket.current?.command("recording.resume");
    await capture.current?.resume();
    startedAt.current = Date.now();
    setState("recording");
    setStatus("Äang tiáº¿p tá»¥c ghi Ã¢m.");
  }

  async function stop(silent = false) {
    if (silent) {
      socket.current?.close();
      await releaseCapture(false);
      return;
    }
    setState("stopping");
    setStatus("Äang hoÃ n táº¥t transcript vÃ  báº£n dá»‹ch cÃ²n láº¡iâ€¦");
    await releaseCapture(true);
    socket.current?.command("recording.stop");
  }

  const canToggleTranslation = state === "recording" || state === "paused" || state === "stopping";
  return <section className="panel recording"><div className="recording-heading"><div><h2>Ghi Ã¢m</h2><p>{status}</p></div><strong className="recording-timer">{formatDuration(elapsed)}</strong></div>{partial && <p className="partial-segment">{partial}</p>}{translationStatus && <p className="realtime-translation-status">{translationStatus}</p>}<div className="recording-actions">{(state === "idle" || state === "failed") && <Button tone="dark" onClick={() => void start()}>{state === "failed" ? "Káº¿t ná»‘i láº¡i" : "Báº¯t Ä‘áº§u"}</Button>}{state === "connecting" && <Button disabled>Äang káº¿t ná»‘iâ€¦</Button>}{state === "recording" && <><Button onClick={() => void pause()}>Táº¡m dá»«ng</Button><Button tone="danger" onClick={() => void stop()}>Káº¿t thÃºc</Button></>}{state === "paused" && <><Button tone="dark" onClick={() => void resume()}>Tiáº¿p tá»¥c</Button><Button tone="danger" onClick={() => void stop()}>Káº¿t thÃºc</Button></>}{state === "stopping" && <Button disabled>ÄÃ£ káº¿t thÃºc</Button>}{canToggleTranslation && <Button disabled={!targetLanguage} onClick={toggleTranslation}>{targetLanguage ? (translationVisible ? "áº¨n báº£n dá»‹ch" : "Dá»‹ch trá»±c tiáº¿p") : "KhÃ´ng thá»ƒ dá»‹ch"}</Button>}</div></section>;
}
function meetingErrorMessage(cause: unknown) {
  const message = cause instanceof Error ? cause.message : "KhÃ´ng thá»ƒ thá»±c hiá»‡n thao tÃ¡c.";
  if (message === "Segments must be contiguous and have the same speaker.") return "Chá»‰ cÃ³ thá»ƒ gá»™p hai Ä‘oáº¡n liá»n ká» cá»§a cÃ¹ng má»™t ngÆ°á»i nÃ³i.";
  return message;
}

function formatTime(milliseconds: number) { const seconds = Math.floor(milliseconds / 1000); return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`; } function formatDuration(seconds: number) { return `${Math.floor(seconds / 3600).toString().padStart(2, "0")}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`; }


