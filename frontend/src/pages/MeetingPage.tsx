import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { MeetingSocket, type RealtimeEvent } from "../realtime/meetingSocket";
import { MicrophonePcmCapture } from "../realtime/microphonePcm";
import { capabilitiesApi, meetingsApi, voiceProfilesApi, type TranscriptMutation } from "../api/endpoints";
import { ApiError } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useJobMonitor } from "../state/useJobMonitor";
import { can } from "../utils/permissions";
import { formatTimestampInput, parseTimestampInput } from "../utils/time";
import type { Comment, ExportArtifact, ExportFormat, Segment, SummaryTemplate, VoiceProfile } from "../types/domain";
import { Button, Empty, Failure, Loading, PageHeading, Status } from "../components/ui";
import { VoiceEnrollmentModal } from "../components/VoiceEnrollmentModal";

type SegmentDraft = { text: string; startTime: string; endTime: string; speakerId: string };
type AudioPlayerHandle = { seek: (milliseconds: number) => void };
type MeetingTab = "info" | "tools" | "speakers" | "comments" | "versions";
type RealtimeTranslation = { text: string; sourceLanguage: string; targetLanguage: string };

export function MeetingPage({ meetingId }: { meetingId: string }) {
  const meeting = useAsync(() => meetingsApi.get(meetingId), [meetingId]);
  const transcript = useAsync(() => meetingsApi.transcript(meetingId), [meetingId]);
  const media = useAsync(() => meetingsApi.media(meetingId), [meetingId]);
  const speakers = useAsync(() => meetingsApi.speakers(meetingId), [meetingId]);
  const capabilities = useAsync(capabilitiesApi.get, []);
  const comments = useAsync(() => meetingsApi.comments(meetingId), [meetingId]);
  const versions = useAsync(() => meetingsApi.versions(meetingId), [meetingId]);
  const voiceProfiles = useAsync(() => voiceProfilesApi.listMeetingProfiles(meetingId), [meetingId]);
  const [editing, setEditing] = useState<Segment>();
  const [draft, setDraft] = useState<SegmentDraft>({ text: "", startTime: "00:00", endTime: "00:00", speakerId: "" });
  const [notice, setNotice] = useState("");
  const [shareOpen, setShareOpen] = useState(false);
  const [voiceEnrollOpen, setVoiceEnrollOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Segment>();
  const [pendingSplit, setPendingSplit] = useState<Segment>();
  const [mergeFirst, setMergeFirst] = useState<Segment>();
  const [pendingMerge, setPendingMerge] = useState<{ first: Segment; second: Segment }>();
  const [latestExport, setLatestExport] = useState<ExportArtifact>();
  const [activeSegmentId, setActiveSegmentId] = useState<string>();
  const [activeTab, setActiveTab] = useState<MeetingTab>("info");
  const [realtimeTranslations, setRealtimeTranslations] = useState<Record<string, RealtimeTranslation>>({});
  const [showRealtimeTranslations, setShowRealtimeTranslations] = useState(false);
  const player = useRef<AudioPlayerHandle>(null);
  const jobMonitor = useJobMonitor();

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
    if (!draft.text.trim() || startMs === undefined || endMs === undefined || endMs <= startMs) return setNotice("Nhập thời gian theo mm:ss hoặc hh:mm:ss; mốc kết thúc phải lớn hơn mốc bắt đầu.");
    try {
      const changedSpeaker = draft.speakerId || null;
      const segmentChanged = editing.text !== draft.text || editing.start_ms !== startMs || editing.end_ms !== endMs;
      if (segmentChanged) await meetingsApi.saveSegment(editing.logical_segment_id, { text: draft.text.trim(), start_ms: startMs, end_ms: endMs });
      if ((editing.speaker_id ?? null) !== changedSpeaker) await meetingsApi.setSegmentSpeaker(editing.logical_segment_id, changedSpeaker);
      await transcript.reload(); await versions.reload(); setEditing(undefined); setNotice("Đã lưu thay đổi và tạo phiên bản transcript mới.");
    } catch (cause) { setNotice((cause as Error).message); }
  }
  async function mutate(action: () => Promise<TranscriptMutation>, success: string, removedId?: string) {
    try { const result = await action(); if (removedId) applyMutation(result, removedId); else { await transcript.reload(); await versions.reload(); } setNotice(success); }
    catch (cause) { setNotice((cause as Error).message); }
  }
  function merge(segment: Segment) {
    if (!mergeFirst) return setMergeFirst(segment);
    if (mergeFirst.logical_segment_id === segment.logical_segment_id) return setMergeFirst(undefined);
    const segments = transcript.data?.segments ?? [];
    const firstIndex = segments.findIndex((item) => item.logical_segment_id === mergeFirst.logical_segment_id);
    const secondIndex = segments.findIndex((item) => item.logical_segment_id === segment.logical_segment_id);
    if (Math.abs(firstIndex - secondIndex) !== 1) { setNotice("Chỉ có thể gộp hai đoạn liền kề."); setMergeFirst(undefined); return; }
    const [first, second] = firstIndex < secondIndex ? [mergeFirst, segment] : [segment, mergeFirst];
    setMergeFirst(undefined); setPendingMerge({ first, second });
  }
  async function run(kind: "translation" | "summary" | "export", value: string) {
    try {
      if (kind === "export") { const artifact = await meetingsApi.export(meetingId, value as ExportFormat); setLatestExport(artifact); if (artifact.job_id) jobMonitor.track({ id: artifact.job_id, status: artifact.status }); setNotice(`Đã tạo xuất ${artifact.format.toUpperCase()}.`); return; }
      const job = kind === "translation" ? await meetingsApi.translation(meetingId, transcript.data?.language ?? "vi", value) : await meetingsApi.summary(meetingId, value as SummaryTemplate, meeting.data?.language_mode === "en" ? "en" : "vi");
      jobMonitor.track(job); setNotice(`Đã tạo tác vụ ${job.id}. Đang theo dõi tiến trình.`);
    } catch (cause) { setNotice((cause as Error).message); }
  }
  async function deleteMeetingVoiceProfile(profileId: string) {
    try {
      await voiceProfilesApi.deleteMeetingGuest(meetingId, profileId);
      await voiceProfiles.reload();
      setNotice("Đã xóa mẫu giọng của người nói.");
    } catch (cause) {
      setNotice((cause as Error).message);
    }
  }
  if (meeting.loading) return <Loading />;
  if (meeting.error || !meeting.data) return <Failure error={meeting.error ?? new Error("Không tìm thấy cuộc họp.")} retry={meeting.reload} />;
  const editable = can(meeting.data.permission, "edit"); const owner = meeting.data.permission === "owner";
  const realtimeTarget = meeting.data.language_mode === "vi" ? "en" : meeting.data.language_mode === "en" ? "vi" : undefined;
  const realtimeTranslationSupported = Boolean(realtimeTarget && capabilities.data?.translation.language_pairs?.some(([source, target]) => source === meeting.data?.language_mode && target === realtimeTarget));
  return <>
    <PageHeading eyebrow={meeting.data.status === "recording" ? "GHI ÂM TRỰC TIẾP" : "PHÁT LẠI & CHI TIẾT"} title={meeting.data.title} description={meeting.data.status === "recording" ? "Các đoạn tạm thời được hiển thị riêng và chỉ được lưu khi máy chủ xác nhận." : `${meeting.data.language_mode.toUpperCase()} · quyền ${meeting.data.permission}`} actions={<><a className="btn btn-light" href={`/meetings/${meetingId}/translation`}>Dịch</a><a className="btn btn-light" href={`/meetings/${meetingId}/summary`}>Tóm tắt</a><a className="btn btn-light" href={`/meetings/${meetingId}/export-share`}>Xuất</a><a className="btn btn-light" href={`/meetings/${meetingId}/upload`}>⇧ Tải tệp</a>{owner && <Button tone="dark" onClick={() => setShareOpen(true)}>⌘ Chia sẻ</Button>}</>} />
    {notice && <div className="notice">{notice}</div>}{jobMonitor.job && <div className={`job-state ${jobMonitor.job.status}`}>Tác vụ {jobMonitor.job.status}{jobMonitor.job.progress !== undefined ? ` · ${jobMonitor.job.progress}%` : ""}{jobMonitor.job.error ? ` · ${jobMonitor.job.error.message}` : ""}</div>}{latestExport && (latestExport.status === "completed" || (latestExport.job_id === jobMonitor.job?.id && jobMonitor.job?.status === "completed")) && <a className="btn btn-dark" href={meetingsApi.exportDownloadUrl(latestExport.id)}>Tải {latestExport.filename ?? latestExport.format.toUpperCase()}</a>}
    <div className="meeting-layout"><section>
      {editable && (meeting.data.status === "created" || (voiceProfiles.data && voiceProfiles.data.length > 0)) && (
        <PreMeetingVoiceProfiles
          meetingId={meetingId}
          profiles={voiceProfiles.data ?? []}
          editable={editable}
          meetingStatus={meeting.data.status}
          onAddClick={() => setVoiceEnrollOpen(true)}
          onDeleteProfile={deleteMeetingVoiceProfile}
        />
      )}
      {editable && capabilities.data?.stt.streaming && <RecordingPanel meetingId={meetingId} targetLanguage={realtimeTranslationSupported ? realtimeTarget : undefined} translationVisible={showRealtimeTranslations} onTranslationVisibleChange={setShowRealtimeTranslations} onTranslation={(logicalSegmentId, translation) => setRealtimeTranslations((current) => ({ ...current, [logicalSegmentId]: translation }))} onFinal={() => { void transcript.reload(); void speakers.reload(); void versions.reload(); }} />}
      {media.data?.[0] && <MediaPlayer ref={player} meetingId={meetingId} mediaId={media.data[0].id} filename={media.data[0].original_filename} segments={transcript.data?.segments ?? []} onActiveSegment={setActiveSegmentId} />}
      <div className="section-title"><h2>Transcript hiện tại</h2>{transcript.data && <Status>Phiên bản {transcript.data.version_no}</Status>}</div>
      {mergeFirst && <div className="notice">Chọn một đoạn liền kề để gộp với đoạn đã chọn, hoặc bấm “Gộp” lần nữa để hủy.</div>}
      {transcript.loading && <Loading label="Đang tải transcript…" />}{transcript.error && <TranscriptState error={transcript.error} uploadHref={`/meetings/${meetingId}/upload`} />}
      {transcript.data?.segments.map((segment) => {
        const segSpeaker = speakers.data?.find((speaker) => speaker.id === segment.speaker_id);
        return (
          <article className={`segment ${activeSegmentId === segment.logical_segment_id ? "is-playing" : ""}`} id={`segment-${segment.logical_segment_id}`} key={segment.logical_segment_id}>
            <div>
              <strong style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                {segSpeaker?.name ?? "Chưa xác định"}
                {segSpeaker?.is_identified && (
                  <span
                    style={{
                      fontSize: "11px",
                      backgroundColor: "#eaf9f1",
                      color: "#087b54",
                      border: "1px solid #bdebd2",
                      padding: "1px 6px",
                      borderRadius: "4px",
                      fontWeight: 600,
                    }}
                    title={
                      segSpeaker.match_confidence
                        ? `Nhận diện tự động qua mẫu giọng (${Math.round(segSpeaker.match_confidence * 100)}%)`
                        : "Đã nhận diện qua mẫu giọng"
                    }
                  >
                    ✓ Đã nhận diện
                  </span>
                )}
              </strong>
              <button className="segment-time" type="button" onClick={() => player.current?.seek(segment.start_ms)}>
                {formatTime(segment.start_ms)} – {formatTime(segment.end_ms)}
              </button>
              {segment.confidence !== undefined && <small>Độ tin cậy {Math.round(segment.confidence * 100)}%</small>}
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
                <div>
                  <Button onClick={() => setEditing(undefined)}>Hủy</Button>
                  <Button tone="dark" onClick={() => void save()}>Lưu phiên bản mới</Button>
                </div>
              </div>
            ) : (
              <>
                <p>{segment.text}</p>
                {showRealtimeTranslations && realtimeTranslations[segment.logical_segment_id] && (
                  <div className="realtime-translation">
                    <small>BẢN DỊCH · {realtimeTranslations[segment.logical_segment_id].targetLanguage.toUpperCase()}</small>
                    <p>{realtimeTranslations[segment.logical_segment_id].text}</p>
                  </div>
                )}
                {editable && (
                  <div className="inline-actions">
                    <Button onClick={() => setEditing(segment)}>Chỉnh sửa</Button>
                    <Button onClick={() => setPendingSplit(segment)}>Tách</Button>
                    <Button className={mergeFirst?.logical_segment_id === segment.logical_segment_id ? "is-selected" : ""} onClick={() => merge(segment)}>
                      {mergeFirst?.logical_segment_id === segment.logical_segment_id ? "Hủy gộp" : "Gộp"}
                    </Button>
                    <Button tone="danger" onClick={() => setPendingDelete(segment)}>Xóa</Button>
                  </div>
                )}
              </>
            )}
          </article>
        );
      })}
    </section><MeetingSidePanel activeTab={activeTab} setActiveTab={setActiveTab} meeting={meeting.data} segmentCount={transcript.data?.segments.length ?? 0} speakerCount={speakers.data?.length ?? 0} editable={editable} capabilities={capabilities.data} run={run} speakers={speakers.data} updateSpeaker={async (id, body) => { const speaker = await meetingsApi.updateSpeaker(id, body); speakers.setData((items) => items?.map((item) => item.id === speaker.id ? speaker : item)); }} meetingId={meetingId} canComment={can(meeting.data.permission, "comment")} comments={comments} versions={versions} voiceProfiles={voiceProfiles.data} onOpenVoiceModal={() => setVoiceEnrollOpen(true)} /></div>
    {shareOpen && <ShareDialog meetingId={meetingId} close={() => setShareOpen(false)} />}
    {voiceEnrollOpen && (
      <VoiceEnrollmentModal
        isOpen={voiceEnrollOpen}
        meetingId={meetingId}
        onClose={() => setVoiceEnrollOpen(false)}
        onEnrolled={async (profile) => {
          await voiceProfiles.reload();
          await speakers.reload();
          setNotice(`Đã lưu mẫu giọng thành công cho "${profile.name}".`);
        }}
      />
    )}
    {pendingSplit && <SplitDialog segment={pendingSplit} close={() => setPendingSplit(undefined)} confirm={(splitAt) => { const segment = pendingSplit; setPendingSplit(undefined); void mutate(() => meetingsApi.splitSegment(segment.logical_segment_id, splitAt), "Đã tách đoạn và tạo phiên bản mới."); }} />}
    {pendingMerge && <ConfirmDialog title="Gộp hai đoạn transcript?" detail="Hai đoạn liền kề sẽ được gộp thành một đoạn và tạo phiên bản transcript mới." confirmLabel="Gộp đoạn" close={() => setPendingMerge(undefined)} confirm={() => { const { first, second } = pendingMerge; setPendingMerge(undefined); void mutate(() => meetingsApi.mergeSegments(first.logical_segment_id, second.logical_segment_id), "Đã gộp hai đoạn và tạo phiên bản mới."); }} />}
    {pendingDelete && <ConfirmDialog title="Xóa đoạn transcript?" detail="Đoạn đã xóa sẽ không còn trong phiên bản transcript hiện hành." confirmLabel="Xóa đoạn" close={() => setPendingDelete(undefined)} confirm={() => { const segment = pendingDelete; setPendingDelete(undefined); void mutate(() => meetingsApi.deleteSegment(segment.logical_segment_id), "Đã xóa đoạn và tạo phiên bản mới.", segment.logical_segment_id); }} />}
  </>;
}

function PreMeetingVoiceProfiles({
  meetingId,
  profiles,
  editable,
  meetingStatus,
  onAddClick,
  onDeleteProfile,
}: {
  meetingId: string;
  profiles: VoiceProfile[];
  editable: boolean;
  meetingStatus: string;
  onAddClick: () => void;
  onDeleteProfile: (profileId: string) => Promise<void>;
}) {
  const isCreated = meetingStatus === "created";
  return (
    <section
      className="panel voice-setup-panel"
      style={{
        marginBottom: "20px",
        borderLeft: isCreated ? "4px solid #087b54" : "1px solid var(--border)",
        background: isCreated ? "#fbfdfc" : "var(--surface)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: "12px",
          marginBottom: "14px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "18px" }}>🎙️</span>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "#10213d", margin: 0 }}>
              Danh sách người nói & Mẫu giọng
            </h2>
            {profiles.length > 0 && (
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: "600",
                  backgroundColor: "#eaf9f1",
                  color: "#087b54",
                  padding: "2px 8px",
                  borderRadius: "999px",
                }}
              >
                {profiles.length} mẫu giọng
              </span>
            )}
          </div>
          <p style={{ margin: "5px 0 0", color: "#667a9a", fontSize: "13px" }}>
            {isCreated
              ? "Trước khi bắt đầu cuộc họp: Hãy tải lên hoặc thu âm mẫu giọng (10-25s) của từng người tham gia để hệ thống tự động gán tên vào transcript khi họ phát biểu."
              : "Các mẫu giọng đã đăng ký được dùng để so khớp cosine similarity và tự động gán tên người phát biểu."}
          </p>
        </div>
        {editable && (
          <Button tone="dark" onClick={onAddClick} style={{ minHeight: "38px", fontSize: "13px" }}>
            + Thêm người nói & Thu âm mẫu giọng
          </Button>
        )}
      </div>

      {profiles.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: "10px",
            marginTop: "12px",
          }}
        >
          {profiles.map((profile) => (
            <div
              key={profile.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 12px",
                border: "1px solid #d9e2ee",
                borderRadius: "8px",
                backgroundColor: "#ffffff",
                boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "9px", minWidth: 0 }}>
                <span
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    backgroundColor: "#eaf0f7",
                    color: "#294362",
                    display: "grid",
                    placeItems: "center",
                    fontWeight: "700",
                    fontSize: "12px",
                    flex: "none",
                  }}
                >
                  {profile.name.slice(0, 2).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <strong
                    style={{
                      display: "block",
                      fontSize: "13px",
                      color: "#10213d",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {profile.name}
                  </strong>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                    <span
                      style={{
                        fontSize: "11px",
                        backgroundColor: "#eaf9f1",
                        color: "#087b54",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        fontWeight: "600",
                      }}
                    >
                      ✓ Đã có mẫu giọng
                    </span>
                    <small style={{ color: "#91a2bd", fontSize: "11px" }}>
                      {Math.max(1, Math.round(profile.sample_duration_ms / 1000))}s
                    </small>
                  </div>
                </div>
              </div>
              {editable && profile.meeting_id === meetingId && (
                <button
                  type="button"
                  title="Xóa mẫu giọng này"
                  onClick={() => void onDeleteProfile(profile.id)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#b42318",
                    padding: "4px 6px",
                    fontSize: "14px",
                    opacity: 0.7,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div
          style={{
            padding: "14px",
            backgroundColor: "#ffffff",
            borderRadius: "8px",
            border: "1px dashed #d9e2ee",
            textAlign: "center",
            color: "#667a9a",
            fontSize: "13px",
          }}
        >
          Chưa có mẫu giọng nào được đăng ký cho cuộc họp này. Bấm{" "}
          <strong>"+ Thêm người nói & Thu âm mẫu giọng"</strong> để đăng ký trước khi bắt đầu.
        </div>
      )}
    </section>
  );
}

function TranscriptState({ error, uploadHref }: { error: Error; uploadHref: string }) { const api = error as ApiError; return <Empty title={api.status === 404 ? "Chưa có transcript" : "Transcript chưa tải được"} detail={api.status === 404 ? "Tải tệp âm thanh để tạo transcript từ backend." : error.message} action={<a className="btn btn-dark" href={uploadHref}>Tải tệp âm thanh</a>} />; }
function MeetingSidePanel({ activeTab, setActiveTab, meeting, segmentCount, speakerCount, editable, capabilities, run, speakers, updateSpeaker, meetingId, canComment, comments, versions, voiceProfiles, onOpenVoiceModal }: { activeTab: MeetingTab; setActiveTab: (tab: MeetingTab) => void; meeting: { status: string; language_mode: string; duration_ms?: number }; segmentCount: number; speakerCount: number; editable: boolean; capabilities?: Awaited<ReturnType<typeof capabilitiesApi.get>>; run: (kind: "translation" | "summary" | "export", value: string) => Promise<void>; speakers?: Array<{ id: string; name: string; role?: string; organization?: string; is_identified?: boolean; match_confidence?: number }>; updateSpeaker: (id: string, body: { name: string; role?: string; organization?: string }) => Promise<void>; meetingId: string; canComment: boolean; comments: { data?: Comment[]; setData: React.Dispatch<React.SetStateAction<Comment[] | undefined>> }; versions: { data?: Array<{ id: string; version_no: number; source: string; created_at: string }>; loading: boolean; error?: Error }; voiceProfiles?: VoiceProfile[]; onOpenVoiceModal?: () => void }) {
  const tabs: Array<[MeetingTab, string]> = [["info", "Thông tin"], ["tools", "Công cụ"], ["speakers", "Người nói"], ["comments", "Bình luận"], ["versions", "Phiên bản"]];
  return <aside className="meeting-side"><div className="meeting-tabs" role="tablist" aria-label="Thông tin và công cụ cuộc họp">{tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>{label}</button>)}</div><div className="meeting-tab-content" role="tabpanel">{activeTab === "info" && <MeetingContext meeting={meeting} segmentCount={segmentCount} speakerCount={speakerCount} />}{activeTab === "tools" && <CapabilityPanel title="Tiếp tục xử lý" disabled={!editable} capabilities={capabilities} onRun={run} />}{activeTab === "speakers" && <SpeakerPanel speakers={speakers} editable={editable} onUpdate={updateSpeaker} voiceProfiles={voiceProfiles} onOpenVoiceModal={onOpenVoiceModal} />}{activeTab === "comments" && <CommentsPanel meetingId={meetingId} canComment={canComment} comments={comments} />}{activeTab === "versions" && <section className="panel"><h2>Phiên bản</h2><VersionList versions={versions} /></section>}</div></aside>;
}
const MediaPlayer = forwardRef<AudioPlayerHandle, { meetingId: string; mediaId: string; filename: string; segments: Segment[]; onActiveSegment: (id?: string) => void }>(function MediaPlayer({ meetingId, mediaId, filename, segments, onActiveSegment }, ref) {
  const audio = useRef<HTMLAudioElement>(null); const [source, setSource] = useState(""); const [error, setError] = useState(""); const [speed, setSpeed] = useState(1);
  useImperativeHandle(ref, () => ({ seek(milliseconds) { const element = audio.current; if (!element) return; element.currentTime = milliseconds / 1000; void element.play(); } }), []);
  useEffect(() => { let active = true; void meetingsApi.playbackUrl(meetingId, mediaId).then((result) => { if (active) setSource(result.url); }).catch((cause: Error) => active && setError(cause.message)); return () => { active = false; }; }, [meetingId, mediaId]);
  function syncTranscript() { const milliseconds = (audio.current?.currentTime ?? 0) * 1000; const segment = segments.find((item) => item.start_ms <= milliseconds && milliseconds < item.end_ms); onActiveSegment(segment?.logical_segment_id); }
  function changeSpeed(next: number) { setSpeed(next); if (audio.current) audio.current.playbackRate = next; }
  return <section className="player"><div className="player-heading"><strong>Nghe lại băng · {filename}</strong>{source && <label>Tốc độ <select value={speed} onChange={(event) => changeSpeed(Number(event.target.value))}><option value={0.75}>0.75×</option><option value={1}>1×</option><option value={1.25}>1.25×</option><option value={1.5}>1.5×</option><option value={2}>2×</option></select></label>}</div>{error ? <div className="form-error">{error}</div> : source ? <audio ref={audio} controls preload="metadata" src={source} onTimeUpdate={syncTranscript} onSeeking={syncTranscript} onEnded={() => onActiveSegment(undefined)}>Trình duyệt không hỗ trợ phát âm thanh.</audio> : <Loading label="Đang chuẩn bị audio…" />}</section>;
});
function MeetingContext({ meeting, segmentCount, speakerCount }: { meeting: { status: string; language_mode: string; duration_ms?: number }; segmentCount: number; speakerCount: number }) { return <section className="panel meeting-context"><h2>Thông tin phiên họp</h2><dl><div><dt>Trạng thái</dt><dd><Status value={meeting.status}>{meeting.status}</Status></dd></div><div><dt>Ngôn ngữ</dt><dd>{meeting.language_mode.toUpperCase()}</dd></div><div><dt>Người nói</dt><dd>{speakerCount || "Chưa xác định"}</dd></div><div><dt>Phân đoạn</dt><dd>{segmentCount}</dd></div></dl></section>; }
function CapabilityPanel({ title, disabled, capabilities, onRun }: { title: string; disabled: boolean; capabilities?: Awaited<ReturnType<typeof capabilitiesApi.get>>; onRun: (kind: "translation" | "summary" | "export", value: string) => Promise<void> }) { const target = capabilities?.translation.languages.find((language) => language !== "vi") ?? "en"; return <section className="panel"><h2>{title}</h2><p>{disabled ? "Bạn có quyền xem. Cần quyền chỉnh sửa để tạo bản dịch hoặc tóm tắt." : "Khả năng được lấy từ provider đang cấu hình."}</p><Button disabled={disabled || !capabilities?.translation.languages.includes(target)} onClick={() => void onRun("translation", target)}>Dịch sang {target.toUpperCase()}</Button>{capabilities?.summary_templates.map((template) => <Button key={template} disabled={disabled} onClick={() => void onRun("summary", template)}>Tóm tắt {template}</Button>)}<hr />{capabilities?.exports.map((format) => <Button key={format} onClick={() => void onRun("export", format)}>Xuất {format.toUpperCase()}</Button>)}</section>; }
function VersionList({ versions }: { versions: { data?: Array<{ id: string; version_no: number; source: string; created_at: string }>; loading: boolean; error?: Error } }) { if (versions.loading) return <Loading />; if (versions.error) return <p>Không tải được lịch sử.</p>; if (!versions.data?.length) return <p>Chưa có phiên bản transcript.</p>; return <ol className="versions">{versions.data.map((version) => <li key={version.id}>v{version.version_no} · {version.source} · {new Date(version.created_at).toLocaleString("vi-VN")}</li>)}</ol>; }
function ConfirmDialog({ title, detail, confirmLabel, close, confirm }: { title: string; detail: string; confirmLabel: string; close: () => void; confirm: () => void }) { return <div className="dialog-backdrop" role="presentation"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">{title}</h2><p>{detail}</p><div className="dialog-actions"><Button onClick={close}>Hủy</Button><Button tone="danger" onClick={confirm}>{confirmLabel}</Button></div></section></div>; }
function SplitDialog({ segment, close, confirm }: { segment: Segment; close: () => void; confirm: (splitAt: number) => void }) { const [splitAt, setSplitAt] = useState(formatTimestampInput(Math.floor((segment.start_ms + segment.end_ms) / 2))); const splitAtMs = parseTimestampInput(splitAt); const valid = splitAtMs !== undefined && splitAtMs > segment.start_ms && splitAtMs < segment.end_ms; return <div className="dialog-backdrop" role="presentation"><section className="dialog" role="dialog" aria-modal="true" aria-labelledby="split-title"><h2 id="split-title">Tách đoạn transcript</h2><p>Chọn mốc nằm giữa {formatTime(segment.start_ms)} và {formatTime(segment.end_ms)}. Nội dung sẽ được chia thành hai đoạn và tạo phiên bản mới.</p><label>Mốc tách (mm:ss)<input inputMode="numeric" placeholder="01:15" value={splitAt} onChange={(event) => setSplitAt(event.target.value)} /></label>{!valid && <div className="form-error">Nhập mm:ss hoặc hh:mm:ss; mốc tách phải nằm bên trong đoạn hiện tại.</div>}<div className="dialog-actions"><Button onClick={close}>Hủy</Button><Button tone="dark" disabled={!valid} onClick={() => confirm(splitAtMs!)}>Tách đoạn</Button></div></section></div>; }
function ShareDialog({ meetingId, close }: { meetingId: string; close: () => void }) { const [email, setEmail] = useState(""); const [permission, setPermission] = useState<"read" | "comment" | "edit">("read"); const [message, setMessage] = useState(""); async function submit(event: React.FormEvent) { event.preventDefault(); try { await meetingsApi.addMember(meetingId, email, permission); setMessage("Đã mời cộng tác viên."); } catch (cause) { setMessage((cause as Error).message); } } return <div className="dialog-backdrop"><form className="dialog" onSubmit={submit}><button className="close" onClick={close} type="button">×</button><h2>Chia sẻ cuộc họp</h2><p>Chỉ owner có thể quản lý quyền truy cập.</p><label>Email<input type="email" value={email} required onChange={(event) => setEmail(event.target.value)} /></label><label>Quyền<select value={permission} onChange={(event) => setPermission(event.target.value as typeof permission)}><option value="read">Xem</option><option value="comment">Bình luận</option><option value="edit">Chỉnh sửa</option></select></label>{message && <div className="form-error">{message}</div>}<Button tone="dark">Gửi lời mời</Button></form></div>; }
function SpeakerPanel({ speakers, editable, onUpdate, voiceProfiles, onOpenVoiceModal }: { speakers?: Array<{ id: string; name: string; role?: string; organization?: string; is_identified?: boolean; match_confidence?: number }>; editable: boolean; onUpdate: (id: string, body: { name: string; role?: string; organization?: string }) => Promise<void>; voiceProfiles?: VoiceProfile[]; onOpenVoiceModal?: () => void }) {
  const [editing, setEditing] = useState<string>();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [organization, setOrganization] = useState("");
  return (
    <section className="panel">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
        <h2 style={{ margin: 0 }}>Người nói</h2>
        {editable && onOpenVoiceModal && (
          <Button style={{ minHeight: "32px", padding: "4px 10px", fontSize: "12px" }} onClick={onOpenVoiceModal}>
            + Mẫu giọng
          </Button>
        )}
      </div>
      {voiceProfiles && voiceProfiles.length > 0 && (
        <div style={{ marginBottom: "14px", padding: "10px 12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
          <small style={{ fontWeight: "700", color: "#475569", display: "block", marginBottom: "6px" }}>
            MẪU GIỌNG ĐÃ ĐĂNG KÝ ({voiceProfiles.length})
          </small>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
            {voiceProfiles.map((p) => (
              <span
                key={p.id}
                style={{
                  fontSize: "11px",
                  backgroundColor: "#eaf9f1",
                  color: "#087b54",
                  padding: "2px 8px",
                  borderRadius: "4px",
                  fontWeight: "600",
                  border: "1px solid #bdebd2",
                }}
              >
                ✓ {p.name} ({Math.max(1, Math.round(p.sample_duration_ms / 1000))}s)
              </span>
            ))}
          </div>
        </div>
      )}
      {speakers?.map((speaker) => (
        <div className="speaker" key={speaker.id}>
          {editing === speaker.id ? (
            <>
              <input aria-label="Tên người nói" value={name} onChange={(event) => setName(event.target.value)} />
              <input aria-label="Vai trò" placeholder="Vai trò" value={role} onChange={(event) => setRole(event.target.value)} />
              <input aria-label="Tổ chức" placeholder="Tổ chức" value={organization} onChange={(event) => setOrganization(event.target.value)} />
              <Button onClick={() => void onUpdate(speaker.id, { name, role: role || undefined, organization: organization || undefined }).then(() => setEditing(undefined))}>
                Lưu
              </Button>
            </>
          ) : (
            <>
              <strong style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                {speaker.name}
                {speaker.is_identified && (
                  <span
                    style={{
                      fontSize: "11px",
                      backgroundColor: "#eaf9f1",
                      color: "#087b54",
                      border: "1px solid #bdebd2",
                      padding: "1px 5px",
                      borderRadius: "4px",
                      fontWeight: 600,
                    }}
                    title={speaker.match_confidence ? `Độ khớp: ${Math.round(speaker.match_confidence * 100)}%` : "Đã nhận diện"}
                  >
                    ✓ Nhận diện giọng
                  </span>
                )}
              </strong>
              <span>
                {speaker.role ?? "Chưa gán vai trò"}
                {speaker.organization ? ` · ${speaker.organization}` : ""}
              </span>
              {editable && (
                <Button onClick={() => { setEditing(speaker.id); setName(speaker.name); setRole(speaker.role ?? ""); setOrganization(speaker.organization ?? ""); }}>
                  Chỉnh sửa
                </Button>
              )}
            </>
          )}
        </div>
      ))}
      {!speakers?.length && <p>Chưa có người nói. Nhãn sẽ được tạo khi provider hỗ trợ diarization.</p>}
    </section>
  );
}
function CommentsPanel({ meetingId, canComment, comments }: { meetingId: string; canComment: boolean; comments: { data?: Comment[]; setData: React.Dispatch<React.SetStateAction<Comment[] | undefined>> } }) { const [body, setBody] = useState(""); const [editing, setEditing] = useState<Comment>(); const [error, setError] = useState(""); async function submit(event: React.FormEvent) { event.preventDefault(); try { const comment = await meetingsApi.addComment(meetingId, body); comments.setData((items) => [...(items ?? []), comment]); setBody(""); setError(""); } catch (cause) { setError((cause as Error).message); } } async function update() { if (!editing) return; try { const comment = await meetingsApi.updateComment(editing.id, editing.body); comments.setData((items) => items?.map((item) => item.id === comment.id ? comment : item)); setEditing(undefined); setError(""); } catch (cause) { setError((cause as Error).message); } } async function remove(id: string) { try { await meetingsApi.deleteComment(id); comments.setData((items) => items?.filter((item) => item.id !== id)); setError(""); } catch (cause) { setError((cause as Error).message); } } return <section className="panel"><h2>Bình luận</h2>{comments.data?.map((comment) => <div className="speaker" key={comment.id}>{editing?.id === comment.id ? <><textarea aria-label="Sửa bình luận" value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} /><Button onClick={() => void update()}>Lưu</Button><Button onClick={() => setEditing(undefined)}>Hủy</Button></> : <><strong>{comment.body}</strong><span>{new Date(comment.created_at).toLocaleString("vi-VN")}</span>{canComment && <><Button onClick={() => setEditing(comment)}>Sửa</Button><Button tone="danger" onClick={() => void remove(comment.id)}>Xóa</Button></>}</>}</div>)}{canComment ? <form className="comments-form" onSubmit={submit}><textarea aria-label="Bình luận" value={body} required onChange={(event) => setBody(event.target.value)} /><Button tone="dark">Gửi bình luận</Button>{error && <div className="form-error">{error}</div>}</form> : <p>Bạn chỉ có quyền xem bình luận.</p>}</section>; }
function RecordingPanel({ meetingId, targetLanguage, translationVisible, onTranslationVisibleChange, onTranslation, onFinal }: { meetingId: string; targetLanguage?: string; translationVisible: boolean; onTranslationVisibleChange: (visible: boolean) => void; onTranslation: (logicalSegmentId: string, translation: RealtimeTranslation) => void; onFinal: () => void }) {
  const { accessToken } = useAuth();
  const socket = useRef<MeetingSocket | undefined>(undefined);
  const capture = useRef<MicrophonePcmCapture | undefined>(undefined);
  const startedAt = useRef<number | undefined>(undefined);
  const elapsedBeforePause = useRef(0);
  const translationEnabled = useRef(false);
  const finalSegmentIds = useRef(new Set<string>());
  const translatedSegmentIds = useRef(new Set<string>());
  const [status, setStatus] = useState("Sẵn sàng ghi âm");
  const [translationStatus, setTranslationStatus] = useState("");
  const [partial, setPartial] = useState("");
  const [partialSpeaker, setPartialSpeaker] = useState<string>();
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
      setStatus("Đang ghi âm và nhận transcript trực tiếp.");
      startedAt.current = Date.now();
      if (translationEnabled.current && targetLanguage) {
        socket.current?.enableTranslation(targetLanguage, missingTranslationIds());
      }
    }
    if (event.type === "transcript.partial") {
      setPartial(event.text);
      setPartialSpeaker(event.speaker_label);
    }
    if (event.type === "transcript.final") {
      setPartial("");
      setPartialSpeaker(undefined);
      finalSegmentIds.current.add(event.logical_segment_id);
      onFinal();
    }
    if (event.type === "transcript.speaker_updated") onFinal();
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
      setState("stopping");
      setStatus("Đã kết thúc ghi âm.");
    }
    if (event.type === "error") {
      setStatus(event.message || "Lỗi realtime.");
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
          setStatus("Mất kết nối, đang thử kết nối lại…");
        }
        if (next === "closed") setState((current) => current === "stopping" ? current : "failed");
      });
      socket.current.connect();
    } catch (cause) {
      await releaseCapture(false);
      setState("failed");
      setStatus(cause instanceof DOMException && cause.name === "NotAllowedError" ? "Cần cấp quyền microphone để ghi âm." : (cause as Error).message);
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
    setTranslationStatus("Đang bật dịch realtime…");
    socket.current?.enableTranslation(targetLanguage, missingTranslationIds());
  }

  async function pause() {
    await capture.current?.pause();
    socket.current?.command("recording.pause");
    elapsedBeforePause.current = elapsed;
    setState("paused");
    setStatus("Đã tạm dừng ghi âm.");
  }

  async function resume() {
    socket.current?.command("recording.resume");
    await capture.current?.resume();
    startedAt.current = Date.now();
    setState("recording");
    setStatus("Đang tiếp tục ghi âm.");
  }

  async function stop(silent = false) {
    if (silent) {
      socket.current?.close();
      await releaseCapture(false);
      return;
    }
    setState("stopping");
    setStatus("Đang hoàn tất transcript và bản dịch còn lại…");
    await releaseCapture(true);
    socket.current?.command("recording.stop");
  }

  const canToggleTranslation = state === "recording" || state === "paused" || state === "stopping";
  return <section className="panel recording"><div className="recording-heading"><div><h2>Ghi âm trực tiếp</h2><p>{status}</p></div><strong className="recording-timer">{formatDuration(elapsed)}</strong></div>{partial && <p className="partial-segment"><strong>{partialSpeaker ? `Người nói ${partialSpeaker} · tạm thời` : "Chưa xác định · tạm thời"}</strong><br />{partial}</p>}{translationStatus && <p className="realtime-translation-status">{translationStatus}</p>}<div className="recording-actions">{(state === "idle" || state === "failed") && <Button tone="dark" onClick={() => void start()}>{state === "failed" ? "Thử kết nối lại" : "Bắt đầu ghi âm"}</Button>}{state === "connecting" && <Button disabled>Đang kết nối…</Button>}{state === "recording" && <><Button onClick={() => void pause()}>Tạm dừng</Button><Button tone="danger" onClick={() => void stop()}>Kết thúc ghi âm</Button></>}{state === "paused" && <><Button tone="dark" onClick={() => void resume()}>Tiếp tục</Button><Button tone="danger" onClick={() => void stop()}>Kết thúc ghi âm</Button></>}{state === "stopping" && <Button disabled>Đã kết thúc</Button>}{canToggleTranslation && <Button disabled={!targetLanguage} onClick={toggleTranslation}>{targetLanguage ? (translationVisible ? "Ẩn dịch realtime" : "Hiện dịch realtime") : "Dịch realtime không khả dụng"}</Button>}</div></section>;
}
function formatTime(milliseconds: number) { const seconds = Math.floor(milliseconds / 1000); return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`; } function formatDuration(seconds: number) { return `${Math.floor(seconds / 3600).toString().padStart(2, "0")}:${Math.floor((seconds % 3600) / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`; }
