import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../auth/AuthContext";
import { MeetingSocket, type RealtimeEvent } from "../realtime/meetingSocket";
import { MicrophonePcmCapture } from "../realtime/microphonePcm";
import { finishLiveTranscript, updateLiveTranscript, type LiveTranscript, type LiveTranscriptEntry, type TranscriptEvent } from "../realtime/liveTranscript";
import { recordRender } from "../realtime/diagnostics";
import { capabilitiesApi, meetingsApi, type TranscriptMutation } from "../api/endpoints";
import { ApiError } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { can } from "../utils/permissions";
import { languageLabel } from "../utils/language";
import { formatTimestampInput, parseTimestampInput } from "../utils/time";
import type { Segment } from "../types/domain";
import { Button, Empty, Failure, Icon, Loading } from "../components/ui";
import { VoiceLearningDialog, VOICE_IDENTITY_UPDATED } from "../components/VoiceLearningDialog";
import { useJobMonitor } from "../state/useJobMonitor";
import { MEETING_TRANSCRIPT_CHANGED, notifyMeetingSectionsChanged, notifyMeetingTranscriptChanged } from "../api/meetingEvents";
import { TranscriptColumnsHeader, TranscriptPair, type RealtimeTranslation } from "../components/TranscriptPair";
import { useRecordingToolbarHost } from "../components/MeetingToolbarContext";
import { RecordingTools, type RecordingState, type RecordingStatusTone } from "../components/RecordingTools";
import { useWorkspaceHeaderHost } from "../components/WorkspaceHeaderContext";
import { MEETING_PLAYBACK_TIME, notifyMeetingPlaybackChanged, seekMeetingPlayback } from "../api/playbackEvents";
import { PauseRecordingDialog } from "../components/PauseRecordingDialog";

type SegmentDraft = { text: string; startTime: string; endTime: string; speakerId: string };
type EmailAttachmentChoice = "audio" | "transcript" | "summary" | "translation";

export function MeetingPage({ meetingId }: { meetingId: string }) {
  const recordingToolbarHost = useRecordingToolbarHost();
  const headerHost = useWorkspaceHeaderHost();
  const meeting = useAsync(() => meetingsApi.get(meetingId), [meetingId]);
  const transcript = useAsync((signal) => meetingsApi.fullTranscript(meetingId, signal), [meetingId]);
  const media = useAsync(() => meetingsApi.media(meetingId), [meetingId]);
  const speakers = useAsync(() => meetingsApi.speakers(meetingId), [meetingId]);
  const capabilities = useAsync(capabilitiesApi.get, []);
  const [editing, setEditing] = useState<Segment>();
  const [draft, setDraft] = useState<SegmentDraft>({ text: "", startTime: "00:00", endTime: "00:00", speakerId: "" });
  const [notice, setNotice] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscript>({});
  const [learningSegment, setLearningSegment] = useState<Segment>();
  const voiceJobs = useJobMonitor();
  const handledVoiceJob = useRef<string | undefined>(undefined);
  const voiceLearningBusy = Boolean(voiceJobs.job && !["completed", "failed"].includes(voiceJobs.job.status));

  useEffect(() => {
    const job = voiceJobs.job;
    if (!job || job.id === handledVoiceJob.current) return;
    if (job.status === "completed") {
      handledVoiceJob.current = job.id;
      setNotice("Đã xác nhận người nói và lưu mẫu giọng để sử dụng cho các cuộc họp sau.");
      void speakers.reload(); void transcript.reload();
      window.dispatchEvent(new Event(VOICE_IDENTITY_UPDATED));
    }
    if (job.status === "failed") {
      handledVoiceJob.current = job.id;
      setNotice(job.error?.message ?? "Không thể học mẫu giọng. Vui lòng chọn lại đoạn âm thanh.");
    }
  }, [voiceJobs.job]);

  const updateRecordingState = useCallback((active: boolean) => {
    setRecordingActive(active);
    if (!active) setLiveTranscript((current) => finishLiveTranscript(current));
  }, []);

  const [pendingDelete, setPendingDelete] = useState<Segment>();
  const [pendingSplit, setPendingSplit] = useState<Segment>();
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [pendingMerge, setPendingMerge] = useState<Segment[]>();
  const [activeSegmentId, setActiveSegmentId] = useState<string>();
  const [realtimeTranslations, setRealtimeTranslations] = useState<Record<string, RealtimeTranslation>>({});
  const [showRealtimeTranslations, setShowRealtimeTranslations] = useState(false);
  const [translationHost, setTranslationHost] = useState<HTMLSpanElement | null>(null);

  useEffect(() => {
    const updateTime = (event: Event) => {
      const detail = (event as CustomEvent<{ meetingId: string; milliseconds: number | null }>).detail;
      if (detail?.meetingId !== meetingId) return;
      setActiveSegmentId(detail.milliseconds === null ? undefined : transcript.data?.segments.find(
        (item) => item.start_ms <= detail.milliseconds! && detail.milliseconds! < item.end_ms,
      )?.logical_segment_id);
    };
    window.addEventListener(MEETING_PLAYBACK_TIME, updateTime);
    return () => window.removeEventListener(MEETING_PLAYBACK_TIME, updateTime);
  }, [meetingId, transcript.data]);

  useEffect(() => {
    // Includes accepted polishing from the toolbar dialog; refresh the visible current transcript.
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ meetingId: string; reloadCurrent?: boolean }>).detail;
      if (detail?.meetingId === meetingId && detail.reloadCurrent) void transcript.reload();
    };
    window.addEventListener(MEETING_TRANSCRIPT_CHANGED, update);
    return () => window.removeEventListener(MEETING_TRANSCRIPT_CHANGED, update);
  }, [meetingId, transcript.reload]);
  useEffect(() => {
    // Also covers final STT, manual edits, voice labels and meeting completion.
    if (meeting.data) notifyMeetingTranscriptChanged(meetingId);
  }, [meetingId, meeting.data?.status, transcript.data?.version_id, transcript.data?.segments.length]);

  useEffect(() => {
    const stored = new Set(transcript.data?.segments.map((segment) => segment.logical_segment_id));
    setLiveTranscript((current) => Object.fromEntries(Object.entries(current).filter(
      ([, event]) => event.type !== "transcript.final" || !stored.has(event.logical_segment_id),
    )));
  }, [transcript.data]);

  useEffect(() => { if (editing) setDraft({ text: editing.text, startTime: formatTimestampInput(editing.start_ms), endTime: formatTimestampInput(editing.end_ms), speakerId: editing.speaker_id ?? "" }); }, [editing]);
  useEffect(() => { if (!activeSegmentId || editing) return; document.getElementById(`segment-${activeSegmentId}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [activeSegmentId, editing]);

  function applyMutation(result: TranscriptMutation, removedId?: string) {
    transcript.setData((current) => {
      if (!current) return current;
      return { ...current, version_id: result.version_id, version_no: result.version_no, segments: removedId ? current.segments.filter((segment) => segment.logical_segment_id !== removedId) : current.segments.map((segment) => segment.logical_segment_id === result.segment?.logical_segment_id ? result.segment : segment) };
    });
  }

  async function save() {
    if (!editing) return;
    const text = draft.text.trim();
    if (!text) return setNotice("Nội dung đoạn ghi âm không được để trống.");
    try {
      const changedSpeaker = draft.speakerId || null;
      const body: { text?: string; start_ms?: number; end_ms?: number } = {};
      if (editing.text !== text) body.text = text;
      const timeChanged = draft.startTime !== formatTimestampInput(editing.start_ms) || draft.endTime !== formatTimestampInput(editing.end_ms);
      if (timeChanged) {
        const startMs = parseTimestampInput(draft.startTime); const endMs = parseTimestampInput(draft.endTime);
        if (startMs === undefined || endMs === undefined || endMs <= startMs) return setNotice("Nhập thời gian theo mm:ss hoặc hh:mm:ss; mốc kết thúc phải lớn hơn mốc bắt đầu.");
        body.start_ms = startMs; body.end_ms = endMs;
      }
      if (Object.keys(body).length) await meetingsApi.saveSegment(editing.logical_segment_id, body);
      if ((editing.speaker_id ?? null) !== changedSpeaker) await meetingsApi.setSegmentSpeaker(editing.logical_segment_id, changedSpeaker);
      if (!Object.keys(body).length && (editing.speaker_id ?? null) === changedSpeaker) { setEditing(undefined); return setNotice("Không có thay đổi mới."); }
      await transcript.reload(); setEditing(undefined); setNotice("Đã lưu thay đổi transcript.");
    } catch (cause) { setNotice(meetingErrorMessage(cause)); }
  }

  async function mutate(action: () => Promise<TranscriptMutation>, success: string, removedId?: string) {
    try { const result = await action(); if (removedId) applyMutation(result, removedId); else await transcript.reload(); setNotice(success); }
    catch (cause) { setNotice(meetingErrorMessage(cause)); }
  }

  function toggleMerge(segment: Segment) {
    setMergeIds((current) => current.includes(segment.logical_segment_id) ? current.filter((id) => id !== segment.logical_segment_id) : [...current, segment.logical_segment_id]);
  }

  function prepareMerge() {
    const segments = transcript.data?.segments ?? [];
    const selected = segments.filter((item) => mergeIds.includes(item.logical_segment_id));
    if (selected.length < 2) return setNotice("Chọn ít nhất hai đoạn để gộp.");
    const indexes = selected.map((item) => segments.findIndex((segment) => segment.logical_segment_id === item.logical_segment_id));
    if (indexes.some((value, index) => index > 0 && value !== indexes[index - 1] + 1)) return setNotice("Các đoạn được chọn phải nằm liền nhau.");
    setPendingMerge(selected);
  }


  if (meeting.loading) return <Loading />;
  if (meeting.error || !meeting.data) return <Failure error={meeting.error ?? new Error("Không tìm thấy cuộc họp.")} retry={meeting.reload} />;

  const editable = can(meeting.data.permission, "edit"); const owner = meeting.data.permission === "owner";
  const realtimeTarget = meeting.data.language_mode === "auto" ? "auto" : meeting.data.language_mode === "vi" ? "en" : meeting.data.language_mode === "en" ? "vi" : undefined;
  const translationPairs = capabilities.data?.translation.language_pairs ?? [];
  const realtimeTranslationSupported = meeting.data.language_mode === "auto"
    ? [["vi", "en"], ["en", "vi"]].every(([source, target]) => translationPairs.some(([from, to]) => from === source && to === target))
    : Boolean(realtimeTarget && translationPairs.some(([source, target]) => source === meeting.data?.language_mode && target === realtimeTarget));

  const displayedSegments = transcript.data?.segments.slice().reverse() ?? [];
  const selectedMergeSegments = transcript.data?.segments.filter((segment) => mergeIds.includes(segment.logical_segment_id)) ?? [];
  const selectedMergePositions = new Map(selectedMergeSegments.map((segment, index) => [segment.logical_segment_id, index + 1]));

  const initialRecordingDurationMs = Math.max(
    meeting.data.duration_ms ?? 0,
    media.data?.[0]?.duration_ms ?? 0,
    ...(transcript.data?.segments.map((segment) => segment.end_ms) ?? [0]),
  );

  const compactHeader = <div className="meeting-compact-header">
      <div className="meeting-compact-identity">
        <h1 title={meeting.data.title}>{meeting.data.title}</h1>
        <span className="meeting-compact-meta">{languageLabel(meeting.data.language_mode)} · {meeting.data.source_type === "realtime" ? "Ghi âm" : "Tệp"}</span>
      </div>
      <div className="meeting-compact-actions">
        {editable && <Button onClick={() => setRenameOpen(true)}>Đổi tên</Button>}
        {meeting.data.source_type === "upload" && <a className="btn btn-light" href={`/meetings/${meetingId}/upload`}>Tải tệp</a>}
        {owner && <Button tone="dark" onClick={() => setShareOpen(true)}>Chia sẻ</Button>}
      </div>
    </div>;

  return <>
    {headerHost ? createPortal(compactHeader, headerHost) : compactHeader}
    {notice && <div className="notice">{notice}</div>}
    {voiceLearningBusy && <div className="notice" role="status">{voiceJobs.error ? "Chưa đọc được tiến độ. Đang thử kết nối lại; yêu cầu lấy mẫu vẫn được lưu trên máy chủ." : "Đang phân tích và lưu mẫu giọng… Bạn có thể tiếp tục cuộc họp."}</div>}
    {recordingToolbarHost && meeting.data.source_type === "realtime" && meeting.data.status === "completed" && createPortal(<RecordingTools
      state="stopped" elapsed={Math.floor(initialRecordingDurationMs / 1000)} status="Cuộc họp đã kết thúc."
      fallbackWarning="" translationStatus="" onStart={() => {}} onPause={() => {}} onResume={() => {}} onEnd={() => {}}
    />, recordingToolbarHost)}

    <div className="meeting-layout">
      <section>

        {/* Realtime Recording Panel */}
        {editable && meeting.data.source_type === "realtime" && meeting.data.status !== "completed" && capabilities.data?.stt.streaming && (
          <RecordingPanel
            meetingId={meetingId}
            translationHost={translationHost}
            onSectionsChanged={() => { notifyMeetingSectionsChanged(meetingId); void transcript.reload(); }}
            targetLanguage={realtimeTranslationSupported ? realtimeTarget : undefined}
            translationVisible={showRealtimeTranslations}
            onTranslationVisibleChange={setShowRealtimeTranslations}
            onTranslation={(logicalSegmentId, translation) => setRealtimeTranslations((current) => ({ ...current, [logicalSegmentId]: translation }))}
            onTranscript={(event) => setLiveTranscript((current) => updateLiveTranscript(current, event))}
            onResetTranscript={() => setLiveTranscript((current) => Object.fromEntries(Object.entries(current).filter(([, event]) => event.type === "transcript.final")))}
            onFinal={() => { void transcript.reload(); void speakers.reload(); }}
            onComplete={() => { void meeting.reload(); void transcript.reload(); void media.reload(); notifyMeetingSectionsChanged(meetingId); notifyMeetingPlaybackChanged(meetingId); }}
            onRecordingStateChange={updateRecordingState}
            hasStartedBefore={
              Boolean(transcript.data?.segments.length) ||
              meeting.data.status === "recording" ||
              meeting.data.status === "processing"
            }
            initialElapsedMs={initialRecordingDurationMs}
          />
        )}

        <div className="section-title transcript-section-title">
          <h2>Nội dung</h2>
          <span ref={setTranslationHost} className="transcript-translation-toggle">
            {meeting.data.status === "completed" && (showRealtimeTranslations || Object.keys(realtimeTranslations).length > 0) && <Button aria-pressed={showRealtimeTranslations} aria-controls="meeting-transcript-content" onClick={() => setShowRealtimeTranslations((visible) => !visible)}>{showRealtimeTranslations ? "Ẩn bản dịch" : "Hiển thị bản dịch"}</Button>}
          </span>
        </div>

        {/* Merge Toolbar */}
        {mergeIds.length > 0 && (
          <div className="merge-toolbar">
            <div className="merge-toolbar-summary">
              <strong>Đã chọn {mergeIds.length} đoạn</strong>
              <div className="merge-selection-list">
                {selectedMergeSegments.map((segment, index) => (
                  <button type="button" key={segment.logical_segment_id} onClick={() => toggleMerge(segment)} title="Bỏ chọn đoạn này">
                    <b>{index + 1}</b>
                    <span>{segment.text}</span>
                    <Icon name="close" />
                  </button>
                ))}
              </div>
            </div>
            <div className="merge-toolbar-actions">
              <Button onClick={() => setMergeIds([])}>Bỏ chọn tất cả</Button>
              <Button tone="dark" disabled={mergeIds.length < 2} onClick={prepareMerge}>Gộp các đoạn</Button>
            </div>
          </div>
        )}

        <div id="meeting-transcript-content" className={`transcript-workspace${showRealtimeTranslations ? " has-translation" : ""}`}>
        <TranscriptColumnsHeader translated={showRealtimeTranslations} />
        {transcript.loading && <TranscriptPair translated={showRealtimeTranslations} speaker="Bản dịch" timestamp="" emptyMessage="Đang tải nội dung gốc để đối chiếu."><Loading label="Đang tải transcript…" /></TranscriptPair>}
        {transcript.error && <TranscriptPair translated={showRealtimeTranslations} speaker="Bản dịch" timestamp="" emptyMessage="Chưa có nội dung dịch để hiển thị."><TranscriptState error={transcript.error} sourceType={meeting.data.source_type} uploadHref={`/meetings/${meetingId}/upload`} /></TranscriptPair>}
        {/* Live Incoming Streaming Transcripts */}
        {Object.entries(liveTranscript)
          .filter(([, event]) => event.type !== "transcript.final" || !transcript.data?.segments.some((segment) => segment.logical_segment_id === event.logical_segment_id))
          .sort(([, a], [, b]) => a.start_ms - b.start_ms)
          .map(([key, event]) => <TranscriptPair
            key={key} translated={showRealtimeTranslations} live
            translation={event.type === "transcript.final" ? realtimeTranslations[event.logical_segment_id] : undefined}
            unconfirmed={event.type !== "transcript.final"}
            speaker={event.speaker_name ?? (event.speaker_label ? `Người nói ${event.speaker_label}` : "Chưa xác định")}
            timestamp={`${formatTime(event.start_ms)} – ${formatTime(event.end_ms)}`}
          ><LiveTranscriptRow event={event} /></TranscriptPair>)}

        {/* Transcript Segments List */}
        {displayedSegments.length ? (
          <div className="transcript-list">
            {displayedSegments.map((segment) => {
              const mergePosition = selectedMergePositions.get(segment.logical_segment_id);
              const mergeSelected = mergePosition !== undefined;
              const segSpeaker = speakers.data?.find((speaker) => speaker.id === segment.speaker_id);
              return (
                <TranscriptPair key={segment.logical_segment_id} translated={showRealtimeTranslations}
                  translation={realtimeTranslations[segment.logical_segment_id]}
                  speaker={segSpeaker?.name ?? "Chưa xác định"}
                  timestamp={`${formatTime(segment.start_ms)} – ${formatTime(segment.end_ms)}`}>
                <article
                  className={`segment ${activeSegmentId === segment.logical_segment_id ? "is-playing" : ""} ${mergeSelected ? "is-merge-selected" : ""}`}
                  id={`segment-${segment.logical_segment_id}`}
                >
                  <div className="segment-meta">
                    <div className="segment-speaker-wrapper">
                      <strong title={segSpeaker?.name ?? "Chưa xác định"}>
                        {segSpeaker?.name ?? "Chưa xác định"}
                      </strong>
                      {segSpeaker?.is_identified && (
                        <span
                          className="speaker-identified-badge"
                          title={
                            segSpeaker.match_confidence
                              ? `Nhận diện tự động qua mẫu giọng (${Math.round(segSpeaker.match_confidence * 100)}%)`
                              : "Đã nhận diện qua mẫu giọng"
                          }
                        >
                          <Icon name="check" /> Đã nhận diện
                        </span>
                      )}
                      {segSpeaker?.voice_profile_id && !segSpeaker.is_identified && <span className="speaker-identified-badge">Đã xác nhận và lưu mẫu</span>}
                    </div>
                    <button className="segment-time" type="button" onClick={() => seekMeetingPlayback(meetingId, segment.start_ms)} aria-label={`Nghe từ ${formatTime(segment.start_ms)}`}>
                      {formatTime(segment.start_ms)} – {formatTime(segment.end_ms)}
                    </button>
                    {segment.confidence !== undefined && <small>{Math.round(segment.confidence * 100)}% tin cậy</small>}
                  </div>

                  {editing?.logical_segment_id === segment.logical_segment_id ? (
                    <div className="editor">
                      <label>
                        Nội dung
                        <textarea value={draft.text} onChange={(event) => setDraft({ ...draft, text: event.target.value })} />
                      </label>
                      <div className="segment-time-fields">
                        <label>
                          Bắt đầu (mm:ss)
                          <input inputMode="numeric" placeholder="01:15" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })} />
                        </label>
                        <label>
                          Kết thúc (mm:ss)
                          <input inputMode="numeric" placeholder="02:30" value={draft.endTime} onChange={(event) => setDraft({ ...draft, endTime: event.target.value })} />
                        </label>
                      </div>
                      <label>
                        Người nói
                        <select value={draft.speakerId} onChange={(event) => setDraft({ ...draft, speakerId: event.target.value })}>
                          <option value="">Chưa xác định</option>
                          {speakers.data?.map((speaker) => <option key={speaker.id} value={speaker.id}>{speaker.name}</option>)}
                        </select>
                      </label>
                      <div className="form-actions">
                        <Button onClick={() => setEditing(undefined)}>Hủy</Button>
                        <Button tone="dark" onClick={() => void save()}>Lưu</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="segment-content">
                      {mergeSelected && <span className="merge-selected-badge"><Icon name="check" />Đoạn gộp số {mergePosition}</span>}
                      <p>{segment.text}</p>
                      {editable && (
                        <div className="inline-actions">
                          <Button onClick={() => setEditing(segment)}>Sửa</Button>
                          <Button disabled={voiceLearningBusy} onClick={() => setLearningSegment(segment)}>Gán tên / Lưu giọng</Button>
                          <Button onClick={() => setPendingSplit(segment)}>Tách</Button>
                          <Button className={mergeSelected ? "is-selected" : ""} onClick={() => toggleMerge(segment)}>
                            {mergeSelected ? `Bỏ chọn #${mergePosition}` : "Chọn gộp"}
                          </Button>
                          <Button tone="danger" onClick={() => setPendingDelete(segment)}>Xóa</Button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
                </TranscriptPair>
              );
            })}
          </div>
        ) : null}
        </div>
      </section>

    </div>

    {renameOpen && <RenameMeetingDialog title={meeting.data.title} close={() => setRenameOpen(false)} confirm={async (title) => { const updated = await meetingsApi.update(meetingId, { title }); meeting.setData(updated); setRenameOpen(false); setNotice("Đã đổi tên bản ghi."); }} />}
    {learningSegment && <VoiceLearningDialog
      meetingId={meetingId} ownerId={meeting.data.owner_id} segment={learningSegment}
      segments={transcript.data?.segments ?? []}
      speaker={speakers.data?.find((item) => item.id === learningSegment.speaker_id)}
      canLearn={Boolean(capabilities.data?.meeting_voice_learning)}
      close={() => setLearningSegment(undefined)}
      onQueued={(job) => { voiceJobs.track(job); setLearningSegment(undefined); }}
      onLabeled={() => { setLearningSegment(undefined); void speakers.reload(); void transcript.reload(); setNotice("Đã gán tên người phát biểu."); }}
    />}
    {shareOpen && <ShareDialog meetingId={meetingId} close={() => setShareOpen(false)} />}
    {pendingSplit && <SplitDialog segment={pendingSplit} close={() => setPendingSplit(undefined)} confirm={(splitAt, first, second) => { const segment = pendingSplit; setPendingSplit(undefined); void mutate(() => meetingsApi.splitSegment(segment.logical_segment_id, splitAt, first, second), "Đã tách đoạn transcript."); }} />}
    {pendingMerge && <ConfirmDialog title={`Gộp ${pendingMerge.length} đoạn?`} detail="Các đoạn đã chọn sẽ được nối theo đúng thứ tự thời gian thành một đoạn." confirmLabel="Gộp đoạn" close={() => setPendingMerge(undefined)} confirm={() => { const selected = pendingMerge; setPendingMerge(undefined); setMergeIds([]); void mutate(() => meetingsApi.mergeSegments(selected.map((segment) => segment.logical_segment_id)), `Đã gộp ${selected.length} đoạn transcript.`); }} />}
    {pendingDelete && <ConfirmDialog title="Xóa đoạn transcript?" detail="Đoạn đã xóa sẽ không còn trong nội dung transcript hiện tại." confirmLabel="Xóa đoạn" close={() => setPendingDelete(undefined)} confirm={() => { const segment = pendingDelete; setPendingDelete(undefined); void mutate(() => meetingsApi.deleteSegment(segment.logical_segment_id), "Đã xóa đoạn transcript.", segment.logical_segment_id); }} />}
  </>;
}

function LiveTranscriptRow({ event }: { event: LiveTranscriptEntry }) {
  useEffect(() => recordRender(event), [event]);
  const isUnconfirmed = event.recognition_status === "unconfirmed";
  return (
    <article className={`live-transcript-row ${isUnconfirmed ? "unconfirmed" : ""}`}>
      <div className="live-transcript-meta">
        <strong>{event.speaker_name ?? (event.speaker_label ? `Người nói ${event.speaker_label}` : "Chưa xác định")}</strong>
        <small>{formatTime(event.start_ms)} – {formatTime(event.end_ms)}</small>
        <span className="live-transcript-badge">
          {event.type === "transcript.final" ? "Đã xác nhận" : isUnconfirmed ? "Chưa lưu" : "Đang nhận diện…"}
        </span>
      </div>
      <div className="live-transcript-content">
        <p>{event.text}</p>
      </div>
    </article>
  );
}


function TranscriptState({ error, sourceType, uploadHref }: { error: Error; sourceType: "realtime" | "upload"; uploadHref: string }) {
  const api = error as ApiError;
  const missing = api.status === 404;
  return <Empty title={missing ? "Chưa có transcript" : "Transcript chưa tải được"} detail={missing ? sourceType === "upload" ? "Tải tệp âm thanh để tạo transcript từ backend." : "Bắt đầu ghi âm để tạo transcript trực tiếp." : error.message} action={missing && sourceType === "upload" ? <a className="btn btn-dark" href={uploadHref}>Tải tệp âm thanh</a> : undefined} />;
}


function ConfirmDialog({ title, detail, confirmLabel, close, confirm }: { title: string; detail: string; confirmLabel: string; close: () => void; confirm: () => void }) {
  return <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{detail}</p><div className="dialog-actions"><Button onClick={close}>Hủy</Button><Button tone="danger" onClick={confirm}>{confirmLabel}</Button></div></section></div>;
}

function RenameMeetingDialog({ title, close, confirm }: { title: string; close: () => void; confirm: (title: string) => Promise<void> }) {
  const [value, setValue] = useState(title); const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) { event.preventDefault(); const next = value.trim(); if (!next) return setError("Tên bản ghi không được để trống."); try { setSaving(true); setError(""); await confirm(next); } catch (cause) { setError((cause as Error).message); setSaving(false); } }
  return <div className="dialog-backdrop"><form className="dialog" onSubmit={submit}><button className="close" onClick={close} type="button">×</button><h2>Đổi tên bản ghi</h2><label>Tên bản ghi<input autoFocus maxLength={200} value={value} onChange={(event) => setValue(event.target.value)} /></label>{error && <div className="form-error">{error}</div>}<div className="dialog-actions"><Button onClick={close}>Hủy</Button><Button type="submit" tone="dark" disabled={saving}>{saving ? "Đang lưu…" : "Lưu tên"}</Button></div></form></div>;
}

function SplitDialog({ segment, close, confirm }: { segment: Segment; close: () => void; confirm: (splitAt: number, first: string, second: string) => void }) {
  const words = segment.text.trim().split(/\s+/);
  const [splitIndex, setSplitIndex] = useState<number>(Math.max(1, Math.floor(words.length / 2)));
  const firstText = words.slice(0, splitIndex).join(" ").trim();
  const secondText = words.slice(splitIndex).join(" ").trim();
  const ratio = firstText.length / (firstText.length + secondText.length || 1);
  const estimatedSplitMs = Math.floor(segment.start_ms + (segment.end_ms - segment.start_ms) * ratio);
  const splitAtMs = Math.max(segment.start_ms + 1, Math.min(segment.end_ms - 1, estimatedSplitMs));

  return <div className="dialog-backdrop" role="presentation">
    <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="split-title" style={{ width: 600 }}>
      <h2 id="split-title">Tách bằng câu</h2>
      <p>Nhấp vào chữ bên dưới để chọn vị trí tách. Đoạn sẽ được chia làm hai.</p>
      <div className="split-text">
        {words.map((word, i) => (
          <span 
            key={i} 
            onClick={() => setSplitIndex(Math.max(1, i))}
            className={`${i >= splitIndex ? "second" : ""} ${i === splitIndex ? "split-point" : ""}`}
          >
            {word}{i < words.length - 1 ? " " : ""}
          </span>
        ))}
      </div>
      <div className="split-preview">
        <div><strong>Đoạn 1</strong><p>{firstText}</p></div>
        <div><strong>Đoạn 2</strong><p>{secondText}</p></div>
      </div>
      <div className="dialog-actions">
        <Button onClick={close}>Hủy</Button>
        <Button tone="dark" disabled={!firstText || !secondText} onClick={() => confirm(splitAtMs, firstText, secondText)}>Tách đoạn</Button>
      </div>
    </section>
  </div>;
}

function ShareDialog({ meetingId, close }: { meetingId: string; close: () => void }) {
  const choices: Array<{ value: EmailAttachmentChoice; label: string; detail: string }> = [
    { value: "audio", label: "Băng ghi âm", detail: "Tệp âm thanh gốc" },
    { value: "transcript", label: "Nội dung bóc băng", detail: "Văn bản kèm thời gian và người nói" },
    { value: "summary", label: "Tóm tắt", detail: "Bản tóm tắt mới nhất" },
    { value: "translation", label: "Bản dịch", detail: "Bản dịch mới nhất" },
  ];
  const [email, setEmail] = useState("");
  const [permission, setPermission] = useState<"read" | "comment" | "edit">("read");
  const [attachments, setAttachments] = useState<EmailAttachmentChoice[]>(["transcript"]);
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState(false);
  const [sending, setSending] = useState(false);
  function toggleAttachment(value: EmailAttachmentChoice) {
    setAttachments((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    try {
      setSending(true);
      setMessage("");
      await meetingsApi.addMember(meetingId, email.trim(), permission, attachments);
      setSuccess(true);
      setMessage(`Đã gửi lời mời${attachments.length ? ` cùng ${attachments.length} tệp đính kèm` : ""} qua email.`);
      setEmail("");
    } catch (cause) {
      setSuccess(false);
      setMessage(meetingErrorMessage(cause));
    } finally {
      setSending(false);
    }
  }
  return <div className="dialog-backdrop"><section className="dialog" role="dialog" aria-modal="true" style={{ width: 520 }}><button className="close" onClick={close} type="button">×</button><h2>Chia sẻ cuộc họp</h2><p>Mời thành viên qua email và cấp quyền truy cập.</p><form onSubmit={submit}><label className="field">Email người nhận<input required type="email" placeholder="dongnghiep@congty.com" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label className="field">Quyền hạn<select value={permission} onChange={(event) => setPermission(event.target.value as typeof permission)}><option value="read">Xem (Chỉ đọc)</option><option value="comment">Bình luận</option><option value="edit">Chỉnh sửa</option></select></label><div className="field"><span>Tệp đính kèm gửi qua email</span><div className="share-attachment-options">{choices.map((item) => <label key={item.value} className="checkbox-row"><input type="checkbox" checked={attachments.includes(item.value)} onChange={() => toggleAttachment(item.value)} /><div><strong>{item.label}</strong><small>{item.detail}</small></div></label>)}</div></div>{message && <div className={success ? "notice" : "form-error"}>{message}</div>}<div className="dialog-actions"><Button onClick={close}>Đóng</Button><Button type="submit" tone="dark" disabled={sending}>{sending ? "Đang gửi…" : "Gửi lời mời"}</Button></div></form></section></div>;
}


function RecordingPanel({
  meetingId,
  translationHost,
  targetLanguage,
  translationVisible,
  onTranslationVisibleChange,
  onTranslation,
  onTranscript,
  onResetTranscript,
  onFinal,
  onComplete,
  onRecordingStateChange,
  hasStartedBefore,
  initialElapsedMs,
  onSectionsChanged,
}: {
  meetingId: string;
  translationHost: HTMLElement | null;
  targetLanguage?: string;
  translationVisible: boolean;
  onTranslationVisibleChange: (visible: boolean) => void;
  onTranslation: (logicalSegmentId: string, translation: RealtimeTranslation) => void;
  onTranscript: (event: TranscriptEvent) => void;
  onResetTranscript: () => void;
  onFinal: () => void;
  onComplete: () => void;
  onRecordingStateChange: (active: boolean) => void;
  hasStartedBefore?: boolean;
  initialElapsedMs: number;
  onSectionsChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const recordingHost = useRecordingToolbarHost();
  const socket = useRef<MeetingSocket | undefined>(undefined);
  const capture = useRef<MicrophonePcmCapture | undefined>(undefined);
  const startedAt = useRef<number | undefined>(undefined);
  const elapsedBeforePause = useRef(Math.floor(initialElapsedMs / 1000));
  const translationEnabled = useRef(false);
  const finalSegmentIds = useRef(new Set<string>());
  const finalTurnIds = useRef(new Set<string>());
  const translatedSegmentIds = useRef(new Set<string>());
  const [status, setStatusMessage] = useState("Sẵn sàng ghi âm");
  const [statusTone, setStatusTone] = useState<RecordingStatusTone>("info");
  const [translationStatus, setTranslationStatus] = useState("");
  const [fallbackWarning, setFallbackWarning] = useState("");
  const [state, setState] = useState<RecordingState>("idle");
  const [elapsed, setElapsed] = useState(Math.floor(initialElapsedMs / 1000));
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [confirmingPause, setConfirmingPause] = useState(false);
  const pausing = useRef(false);

  function setStatus(message: string, tone: RecordingStatusTone = "info") {
    setStatusMessage(message);
    setStatusTone(tone);
  }

  useEffect(() => () => { void pauseForNavigation(); }, []);
  useEffect(() => { if (state !== "recording") setConfirmingPause(false); }, [state]);
  useEffect(() => {
    if (state !== "pausing" && state !== "resuming") return;
    const timer = window.setTimeout(() => {
      socket.current?.close();
      void releaseCapture(false);
      setState("failed");
      setStatus("Chưa nhận được xác nhận phiên họp. Vui lòng kết nối lại và kiểm tra danh sách phiên trước khi tiếp tục.");
      onSectionsChanged();
    }, 90000);
    return () => window.clearTimeout(timer);
  }, [state]);
  useEffect(() => {
    if (state !== "stopping") return;
    const timer = window.setTimeout(() => {
      void meetingsApi.get(meetingId).then((value) => {
        if (value.status === "completed") { setState("stopped"); onComplete(); }
        else { setState("failed"); setStatus("Chưa nhận được xác nhận kết thúc. Vui lòng kiểm tra kết nối và thử lại."); }
      }).catch(() => { setState("failed"); setStatus("Không đọc được trạng thái kết thúc. Vui lòng tải lại để kiểm tra."); });
    }, 90000);
    return () => window.clearTimeout(timer);
  }, [state, meetingId]);
  useEffect(() => {
    const refreshVoices = () => socket.current?.command("speakers.refresh");
    window.addEventListener(VOICE_IDENTITY_UPDATED, refreshVoices);
    return () => window.removeEventListener(VOICE_IDENTITY_UPDATED, refreshVoices);
  }, []);
  useEffect(() => onRecordingStateChange(state !== "idle" && state !== "stopped" && state !== "failed"), [state, onRecordingStateChange]);
  useEffect(() => {
    if (state !== "idle") return;
    const initialSeconds = Math.floor(initialElapsedMs / 1000);
    elapsedBeforePause.current = initialSeconds;
    setElapsed(initialSeconds);
  }, [initialElapsedMs, state]);
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
    if (event.type === "meeting.sections") {
      setState("paused");
      onSectionsChanged(); onResetTranscript();
      const next = event.sections.at(-1);
      setStatus(`Đã chuẩn bị ${next ? `Phiên ${next.sequence}` : "phiên tiếp theo"}. Mở “Phiên họp” để đặt tên; bấm Tiếp tục khi sẵn sàng.`);
    }
    if (event.type === "recording.resumed") {
      void capture.current?.resume();
      startedAt.current = Date.now(); setState("recording"); onSectionsChanged();
      setFallbackWarning(event.fallback_active ? "Đang chép lời dự phòng; nhận diện theo tên tạm thời không khả dụng." : "");
      setStatus(event.new_section ? "Đang ghi âm vào phiên mới." : "Đang tiếp tục ghi âm trong phiên hiện tại.");
    }
    if (event.type === "recording.paused") {
      setState("paused");
      setStatus("Đã tạm dừng, giữ nguyên phiên hiện tại. Bấm Tiếp tục khi sẵn sàng.");
    }
    if (event.type === "session.ready") {
      onSectionsChanged();
      onResetTranscript();
      if (event.paused) {
        setState("paused"); setStatus("Đã kết nối lại, ghi âm vẫn tạm dừng. Bấm Tiếp tục khi sẵn sàng.");
        return;
      }
      void capture.current?.resume();
      setState("recording");
      setStatus("Đang ghi âm và nhận transcript trực tiếp.");
      setFallbackWarning(event.fallback_active ? "Đang chép lời dự phòng; nhận diện theo tên tạm thời không khả dụng." : "");
      startedAt.current = Date.now();
      if (translationEnabled.current && targetLanguage) {
        socket.current?.enableTranslation(targetLanguage, missingTranslationIds());
      }
    }
    if (event.type === "transcript.partial") {
      if (!event.stream_segment_id || !finalTurnIds.current.has(event.stream_segment_id)) onTranscript(event);
    }
    if (event.type === "transcript.final") {
      if (event.stream_segment_id?.match(/(?:^|:)turn:\d+$/)) finalTurnIds.current.add(event.stream_segment_id);
      onTranscript(event);
      finalSegmentIds.current.add(event.logical_segment_id);
      onFinal();
    }
    if (event.type === "transcript.speaker_updated") onFinal();
    if (event.type === "speakers.updated") {
      setStatus(event.deferred ? "Mẫu giọng mới sẽ được áp dụng khi bấm Tiếp tục." : "Đã cập nhật mẫu giọng. Đang tiếp tục nhận diện người nói.");
      setFallbackWarning(event.fallback_active ? "Đang chép lời dự phòng; nhận diện theo tên tạm thời không khả dụng." : "");
      onFinal();
    }
    if (event.type === "translation.status") {
      setTranslationStatus(event.enabled ? "Đang dịch trực tiếp các đoạn đã được xác nhận." : "");
    }
    if (event.type === "translation.final") {
      translatedSegmentIds.current.add(event.logical_segment_id);
      onTranslation(event.logical_segment_id, {
        text: event.text,
        sourceLanguage: event.source_language,
        targetLanguage: event.target_language,
      });
      setTranslationStatus("Đã cập nhật bản dịch realtime.");
    }
    if (event.type === "translation.error") {
      setTranslationStatus(`Dịch realtime: ${event.message}`);
    }
    if (event.type === "meeting.status") {
      setState("stopped");
      setStatus("Đã kết thúc ghi âm.");
      onComplete();
    }
    if (event.type === "error") {
      setStatus(event.message || "Lỗi realtime.", "error");
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
      setStatus("Đang xin quyền microphone và kết nối…");
      capture.current = await MicrophonePcmCapture.open((chunk) => socket.current?.sendAudio(chunk));
      socket.current = new MeetingSocket(meetingId, accessToken, event, (next) => {
        if (next === "reconnecting") {
          void capture.current?.pause();
          setStatus("Mất kết nối, đang thử kết nối lại…", "warning");
        }
        if (next === "closed") setState((current) => current === "stopped" ? "stopped" : current === "stopping" ? "stopping" : "failed");
      });
      socket.current.connect();
    } catch (cause) {
      await releaseCapture(false);
      setState("failed");
      setStatus(cause instanceof DOMException && cause.name === "NotAllowedError" ? "Cần cấp quyền microphone để ghi âm." : (cause as Error).message);
    }
  }

  function toggleTranslation() {
    if (translationVisible) {
      translationEnabled.current = false;
      onTranslationVisibleChange(false);
      setTranslationStatus("");
      socket.current?.disableTranslation();
      return;
    }
    if (!targetLanguage) return;
    translationEnabled.current = true;
    onTranslationVisibleChange(true);
    setTranslationStatus("Đang bật dịch realtime…");
    socket.current?.enableTranslation(targetLanguage, missingTranslationIds());
  }

  async function pause(newSection: boolean) {
    setConfirmingPause(false);
    if (state !== "recording" || pausing.current) return;
    pausing.current = true;
    setState("pausing");
    try {
      await capture.current?.pause();
      elapsedBeforePause.current = elapsed;
      if (!socket.current?.command("recording.pause", { new_section: newSection, acknowledge: true })) {
        setState("failed"); setStatus("Mất kết nối; chưa xác nhận được tạm dừng. Kết nối lại để kiểm tra.");
      } else setStatus(newSection ? "Đang lưu lời nói cuối và tạo phiên kế tiếp…" : "Đang tạm dừng, giữ nguyên phiên hiện tại…");
    } catch (cause) {
      setState("failed"); setStatus(cause instanceof Error ? cause.message : "Không thể tạm dừng microphone. Vui lòng kết nối lại.");
    } finally { pausing.current = false; }
  }

  async function resume() {
    setState("resuming"); setStatus("Đang tiếp tục ghi âm…");
    if (!socket.current?.command("recording.resume", { acknowledge: true })) { setState("failed"); setStatus("Mất kết nối; vui lòng kết nối lại."); }
  }

  async function pauseForNavigation() {
    // Component teardown means the user is leaving this feature, not ending the
    // meeting. Flush the last microphone samples, pause the provider when the
    // connection is still writable, then release local resources.
    await releaseCapture(true);
    socket.current?.command("recording.pause");
    socket.current?.close();
    socket.current = undefined;
  }

  async function stop() {
    setState("stopping");
    setStatus("Đang hoàn tất transcript và kết thúc bản ghi…");
    await releaseCapture(true);
    // Wait for server acknowledgment: closing upstream flushes the last final
    // segments before completion and the proofreading snapshot are persisted.
    if (!socket.current?.command("recording.stop")) {
      setState("failed");
      setStatus("Mất kết nối trước khi kết thúc. Vui lòng kết nối lại để hoàn tất transcript.");
    }
  }

  async function finishExisting() {
    setState("stopping");
    setStatus("Đang kết thúc bản ghi…");
    try {
      await meetingsApi.complete(meetingId);
      setState("stopped");
      setStatus("Đã kết thúc ghi âm.");
      onComplete();
    } catch (cause) {
      setState("failed");
      setStatus(cause instanceof Error ? cause.message : "Không thể kết thúc bản ghi.");
    }
  }

  async function confirmEnd() {
    setConfirmingEnd(false);
    if (state === "recording" || state === "paused") {
      await stop();
      return;
    }
    await finishExisting();
  }

  const canToggleTranslation = state === "recording" || state === "paused" || state === "stopping";
  const translationReason = !targetLanguage ? "Không có dịch trực tiếp cho ngôn ngữ hoặc provider hiện tại." : !canToggleTranslation ? "Bắt đầu hoặc tiếp tục ghi âm trước khi bật dịch." : undefined;
  return <>
    {recordingHost && createPortal(<RecordingTools
      state={state} elapsed={elapsed} status={status} statusTone={statusTone} fallbackWarning={fallbackWarning}
      translationStatus={translationStatus} hasStartedBefore={hasStartedBefore}
      onStart={() => { void start(); }} onPause={() => setConfirmingPause(true)} onResume={() => { void resume(); }}
      onEnd={() => setConfirmingEnd(true)}
    />, recordingHost)}
    {translationHost && createPortal(<Button
      disabled={!translationVisible && (!targetLanguage || !canToggleTranslation)}
      title={!translationVisible ? translationReason : undefined}
      aria-pressed={translationVisible} aria-controls="meeting-transcript-content" onClick={toggleTranslation}
    >{translationVisible ? "Ẩn bản dịch" : "Hiển thị bản dịch"}</Button>, translationHost)}
    {confirmingPause && state === "recording" && <PauseRecordingDialog choose={(newSection) => { void pause(newSection); }} />}
    {confirmingEnd && <ConfirmDialog
      title="Kết thúc cuộc họp?"
      detail="Cuộc họp sẽ được hoàn tất và bạn sẽ không thể tiếp tục ghi âm. Bạn có chắc chắn muốn kết thúc?"
      confirmLabel="Xác nhận kết thúc"
      close={() => setConfirmingEnd(false)}
      confirm={() => { void confirmEnd(); }}
    />}
  </>;
}

function meetingErrorMessage(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.code === "SEGMENTS_NOT_MERGEABLE") return "Các đoạn được chọn phải nằm liền nhau trong nội dung hiện tại.";
    if (cause.code === "USER_NOT_FOUND") return "Email này chưa có tài khoản Bóc Băng. Người nhận cần đăng ký trước bằng đúng email.";
    if (cause.code === "EMAIL_DELIVERY_FAILED") return "Đã có lỗi khi gửi email. Vui lòng kiểm tra địa chỉ và thử lại.";
  }
  const message = cause instanceof Error ? cause.message : "Không thể thực hiện thao tác.";
  if (message === "Segments must be contiguous and have the same speaker.") return "Chỉ có thể gộp hai đoạn liền kề của cùng một người nói.";
  return message;
}

function formatTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
