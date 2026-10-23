import { useEffect, useRef, useState } from "react";
import { meetingsApi, voiceLearningApi, voiceProfilesApi } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { useAsync } from "../hooks/useAsync";
import type { Job, Segment, Speaker } from "../types/domain";
import { Button } from "./ui";

export const VOICE_IDENTITY_UPDATED = "bocbang:voice-identity-updated";

export function VoiceLearningDialog({ meetingId, ownerId, segment, segments, speaker, canLearn, close, onQueued, onLabeled }: {
  meetingId: string; ownerId?: string; segment: Segment; segments: Segment[]; speaker?: Speaker;
  canLearn: boolean; close: () => void; onQueued: (job: Job) => void; onLabeled: () => void;
}) {
  const { user } = useAuth();
  const profiles = useAsync(() => voiceProfilesApi.listMeetingProfiles(meetingId), [meetingId]);
  const [ids, setIds] = useState([segment.logical_segment_id]);
  const [name, setName] = useState(speaker?.name.startsWith("Người nói ") ? "" : speaker?.name ?? "");
  const [profileId, setProfileId] = useState(speaker?.voice_profile_id ?? "");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string>();
  const previewRequest = useRef(0);
  const candidates = segments.filter((item) => item.speaker_id === segment.speaker_id);
  const selected = candidates.filter((item) => ids.includes(item.logical_segment_id));
  const duration = Math.min(25_000, selected.reduce((total, item) => total + item.end_ms - item.start_ms, 0));
  const reusableProfiles = profiles.data?.filter((profile) => !profile.meeting_id && (profile.user_id === user?.id || profile.user_id === ownerId)) ?? [];
  const chosen = reusableProfiles.find((profile) => profile.id === profileId);

  useEffect(() => {
    if (profiles.data && profileId && !reusableProfiles.some((profile) => profile.id === profileId)) setProfileId("");
  }, [profiles.data]);

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => { previewRequest.current += 1; }, []);

  function toggle(id: string) {
    setIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    previewRequest.current += 1;
    setPreviewing(false);
    setPreviewUrl(undefined);
    setError("");
  }

  async function preview() {
    const current = ++previewRequest.current;
    setPreviewing(true);
    setError("");
    try {
      const blob = await voiceLearningApi.preview(meetingId, ids);
      if (current === previewRequest.current) setPreviewUrl(URL.createObjectURL(blob));
    } catch (cause) {
      if (current === previewRequest.current) setError((cause as Error).message);
    } finally {
      if (current === previewRequest.current) setPreviewing(false);
    }
  }

  async function submit(learn: boolean) {
    if (!name.trim() || !ids.length) return;
    setSubmitting(true);
    setError("");
    try {
      if (learn) {
        onQueued(await voiceLearningApi.learn(meetingId, { name: name.trim(), segment_ids: ids, profile_id: profileId || undefined }));
      } else {
        if (speaker) {
          await meetingsApi.updateSpeaker(speaker.id, { name: name.trim() });
        } else {
          const created = await meetingsApi.createSpeaker(meetingId, { name: name.trim() });
          for (const id of ids) await meetingsApi.setSegmentSpeaker(id, created.id);
        }
        onLabeled();
      }
    } catch (cause) {
      setError((cause as Error).message);
      setSubmitting(false);
    }
  }

  return <div className="dialog-backdrop"><section className="dialog voice-learning-dialog" role="dialog" aria-modal="true" aria-labelledby="voice-learning-title">
    <button className="close" type="button" disabled={submitting} aria-label="Đóng" onClick={close}>×</button>
    <h2 id="voice-learning-title">Gán tên người phát biểu</h2>
    <p>Chọn đoạn chỉ có giọng của người này. Bạn có thể ghép nhiều đoạn cùng người nói; hệ thống lấy tối đa 25 giây để lưu mẫu dùng cho các cuộc họp sau.</p>
    <label className="field">Hồ sơ giọng nói
      <select value={profileId} disabled={submitting} onChange={(event) => {
        setProfileId(event.target.value);
        const profile = reusableProfiles.find((item) => item.id === event.target.value);
        if (profile) setName(profile.name);
      }}>
        <option value="">Tạo hồ sơ mới từ cuộc họp này</option>
        {reusableProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.sample_count}/3 mẫu</option>)}
      </select>
    </label>
    <label className="field">Tên người phát biểu<input autoFocus maxLength={255} value={name} disabled={submitting} onChange={(event) => setName(event.target.value)} placeholder="Ví dụ: Nguyễn Văn Nam" /></label>
    {speaker && <p className="voice-learning-hint">Tên được áp dụng cho người nói “{speaker.name}” trong cuộc họp. Chỉ những đoạn đánh dấu dưới đây được dùng để lấy mẫu.</p>}
    <div className="voice-sample-heading"><strong>Đoạn dùng làm mẫu</strong><span>{(duration / 1000).toFixed(1)} / 10 giây tối thiểu</span></div>
    <div className="voice-sample-segments">
      {candidates.map((item) => <label key={item.logical_segment_id}>
        <input type="checkbox" checked={ids.includes(item.logical_segment_id)} disabled={submitting || (!ids.includes(item.logical_segment_id) && ids.length >= 50)} onChange={() => toggle(item.logical_segment_id)} />
        <span><small>{(item.start_ms / 1000).toFixed(1)}s – {(item.end_ms / 1000).toFixed(1)}s</small><span>{item.text}</span></span>
      </label>)}
    </div>
    <div className="voice-sample-preview"><Button disabled={!ids.length || previewing || submitting} onClick={() => { void preview(); }}>{previewing ? "Đang lấy âm thanh…" : "Nghe đoạn đã chọn"}</Button>{previewUrl && <audio controls src={previewUrl} />}</div>
    {!canLearn && <p className="voice-learning-hint">Chưa bật tạo mẫu giọng trên máy chủ. Bạn vẫn có thể gán tên cho người nói.</p>}
    {chosen && chosen.sample_count >= 3 && <p className="voice-learning-hint">Hồ sơ đã đủ 3 mẫu. Bạn có thể gán tên hoặc quản lý mẫu cũ trong Mẫu giọng.</p>}
    {error && <div className="form-error" role="alert">{error}</div>}
    <div className="dialog-actions">
      <Button disabled={submitting} onClick={close}>Hủy</Button>
      <Button disabled={submitting || !name.trim() || !ids.length} onClick={() => { void submit(false); }}>Chỉ gán tên</Button>
      <Button tone="dark" disabled={!canLearn || submitting || !name.trim() || duration < 10_000 || (chosen?.sample_count ?? 0) >= 3} onClick={() => { void submit(true); }}>{submitting ? "Đang gửi…" : "Gán tên và lưu mẫu giọng"}</Button>
    </div>
  </section></div>;
}
