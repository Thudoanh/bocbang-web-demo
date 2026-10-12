import { useState, useRef, useEffect } from "react";
import { voiceProfilesApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { Button, Empty, Failure, Icon, Loading, PageHeading } from "../components/ui";
import { VoiceEnrollmentModal } from "../components/VoiceEnrollmentModal";
import type { VoiceProfile } from "../types/domain";

export function VoiceProfilesPage() {
  const profilesQuery = useAsync(() => voiceProfilesApi.list(), []);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [search, setSearch] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [sampleModalProfile, setSampleModalProfile] = useState<VoiceProfile | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteProfile, setConfirmDeleteProfile] = useState<VoiceProfile | null>(null);

  // Audio playback state
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingAudioId, setLoadingAudioId] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (profilesQuery.data) {
      setProfiles(profilesQuery.data);
    }
  }, [profilesQuery.data]);

  // Clean up cached audio object URLs on unmount
  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      audioCacheRef.current.forEach((url) => URL.revokeObjectURL(url));
      audioCacheRef.current.clear();
    };
  }, []);

  const handlePlay = async (profile: VoiceProfile) => {
    setAudioError(null);

    // If currently playing this profile, toggle pause
    if (playingId === profile.id && currentAudioRef.current) {
      currentAudioRef.current.pause();
      setPlayingId(null);
      return;
    }

    // Stop currently playing audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
      setPlayingId(null);
    }

    try {
      let objectUrl = audioCacheRef.current.get(profile.id);
      if (!objectUrl) {
        setLoadingAudioId(profile.id);
        const blob = await voiceProfilesApi.getAudioBlob(profile.id);
        objectUrl = URL.createObjectURL(blob);
        audioCacheRef.current.set(profile.id, objectUrl);
      }

      const audio = new Audio(objectUrl);
      currentAudioRef.current = audio;

      audio.onplay = () => {
        setPlayingId(profile.id);
        setLoadingAudioId(null);
      };

      audio.onended = () => {
        setPlayingId(null);
        currentAudioRef.current = null;
      };

      audio.onerror = () => {
        setAudioError(`Không thể phát âm thanh của ${profile.name}.`);
        setPlayingId(null);
        setLoadingAudioId(null);
        currentAudioRef.current = null;
      };

      await audio.play();
    } catch (cause) {
      setAudioError((cause as Error).message || `Không thể tải file âm thanh của ${profile.name}.`);
      setPlayingId(null);
      setLoadingAudioId(null);
    }
  };

  const handleDelete = async (profile: VoiceProfile) => {
    setDeletingId(profile.id);
    try {
      await voiceProfilesApi.delete(profile.id);
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
      setConfirmDeleteProfile(null);
      if (playingId === profile.id && currentAudioRef.current) {
        currentAudioRef.current.pause();
        setPlayingId(null);
      }
    } catch (cause) {
      setAudioError((cause as Error).message || "Không thể xóa mẫu giọng.");
    } finally {
      setDeletingId(null);
    }
  };

  const filtered = profiles.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <>
      <PageHeading
        title="Mẫu giọng"
        description="Quản lý danh sách người nói và mẫu giọng Speechmatics để tự động nhận diện và gán tên người phát biểu trong mọi cuộc họp."
        actions={
          <Button
            tone="dark"
            onClick={() => setCreateModalOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              padding: "10px 18px",
              fontSize: "14px",
              fontWeight: 600,
            }}
          >
            <Icon name="plus" />
            + Thêm mẫu giọng người nói
          </Button>
        }
      />

      <div style={{ marginTop: 20 }}>
        {/* Search and summary bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "12px",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "18px" }}>🎙️</span>
            <strong style={{ fontSize: "15px" }}>Danh sách người nói & Mẫu giọng</strong>
            {profiles.length > 0 && (
              <span className="status completed" style={{ borderRadius: "999px", fontSize: "12px" }}>
                {profiles.length} mẫu giọng
              </span>
            )}
          </div>

          {profiles.length > 0 && (
            <div style={{ width: "260px" }}>
              <input
                type="text"
                placeholder="Tìm kiếm người nói…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: "8px",
                  border: "1px solid var(--border)",
                  fontSize: "13px",
                  background: "var(--surface)",
                  color: "inherit",
                }}
              />
            </div>
          )}
        </div>

        {audioError && (
          <div
            style={{
              padding: "10px 14px",
              marginBottom: "16px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "8px",
              color: "#b91c1c",
              fontSize: "13px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{audioError}</span>
            <button
              onClick={() => setAudioError(null)}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#b91c1c" }}
            >
              ✕
            </button>
          </div>
        )}

        {profilesQuery.loading && <Loading label="Đang tải danh sách mẫu giọng…" />}
        {profilesQuery.error && (
          <Failure error={profilesQuery.error} retry={profilesQuery.reload} />
        )}

        {!profilesQuery.loading && !profilesQuery.error && (
          <>
            {filtered.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(290px, 1fr))",
                  gap: "14px",
                }}
              >
                {filtered.map((profile) => {
                  const isPlaying = playingId === profile.id;
                  const isLoadingAudio = loadingAudioId === profile.id;
                  const initials = profile.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();

                  return (
                    <article
                      key={profile.id}
                      style={{
                        padding: "16px 18px",
                        background: "var(--surface)",
                        borderRadius: "var(--radius, 12px)",
                        border: isPlaying ? "2px solid #6366f1" : "1px solid var(--border)",
                        boxShadow: isPlaying
                          ? "0 4px 12px rgba(99, 102, 241, 0.15)"
                          : "0 1px 3px rgba(0,0,0,0.04)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        transition: "all 0.15s ease",
                      }}
                    >
                      {/* Top row: Avatar, Name, Sample Badge */}
                      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                        <div
                          style={{
                            width: "36px",
                            height: "36px",
                            borderRadius: "50%",
                            background: "var(--surface-soft, #f3f4f6)",
                            border: "1px solid var(--border)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "13px",
                            fontWeight: 700,
                            flexShrink: 0,
                            color: "var(--text)",
                          }}
                        >
                          {initials}
                        </div>

                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                            <strong
                              style={{
                                fontSize: "15px",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                              title={profile.name}
                            >
                              {profile.name}
                            </strong>
                            <span
                              style={{
                                fontSize: "11px",
                                fontWeight: 600,
                                padding: "1px 7px",
                                borderRadius: "999px",
                                background:
                                  profile.sample_count >= 3
                                    ? "var(--success-soft, #ecfdf5)"
                                    : "var(--surface-soft, #f3f4f6)",
                                color:
                                  profile.sample_count >= 3
                                    ? "var(--success, #059669)"
                                    : "var(--muted, #6b7280)",
                                border: "1px solid var(--border)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {profile.sample_count}/3 mẫu
                            </span>
                          </div>

                          <small
                            style={{
                              color: "var(--muted)",
                              fontSize: "12px",
                              display: "block",
                              marginTop: "2px",
                            }}
                          >
                            {(profile.sample_duration_ms / 1000).toFixed(1)}s · {profile.provider}
                          </small>
                        </div>
                      </div>

                      {/* Bottom actions: Nghe lại, + Mẫu, Xóa */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                          paddingTop: "8px",
                          borderTop: "1px solid var(--border)",
                        }}
                      >
                        <Button
                          onClick={() => void handlePlay(profile)}
                          disabled={isLoadingAudio}
                          style={{
                            minHeight: "32px",
                            padding: "4px 10px",
                            fontSize: "12px",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "5px",
                            background: isPlaying ? "#6366f1" : undefined,
                            color: isPlaying ? "#ffffff" : undefined,
                            borderColor: isPlaying ? "#6366f1" : undefined,
                          }}
                        >
                          {isLoadingAudio ? (
                            "Đang tải…"
                          ) : isPlaying ? (
                            <>
                              <span style={{ fontSize: "10px" }}>⏸</span> Tạm dừng
                            </>
                          ) : (
                            <>
                              <span style={{ fontSize: "10px" }}>▶</span> Nghe lại
                            </>
                          )}
                        </Button>

                        <div style={{ display: "flex", gap: "6px" }}>
                          {profile.sample_count < 3 && (
                            <Button
                              onClick={() => setSampleModalProfile(profile)}
                              style={{
                                minHeight: "32px",
                                padding: "4px 10px",
                                fontSize: "12px",
                                fontWeight: 500,
                              }}
                            >
                              + Mẫu
                            </Button>
                          )}
                          <Button
                            tone="danger"
                            onClick={() => setConfirmDeleteProfile(profile)}
                            disabled={deletingId === profile.id}
                            style={{
                              minHeight: "32px",
                              padding: "4px 10px",
                              fontSize: "12px",
                            }}
                          >
                            Xóa
                          </Button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : profiles.length > 0 ? (
              <Empty
                title="Không tìm thấy mẫu giọng"
                detail={`Không có người nói nào khớp với từ khóa "${search}".`}
                action={
                  <Button tone="light" onClick={() => setSearch("")}>
                    Xóa tìm kiếm
                  </Button>
                }
              />
            ) : (
              <div
                style={{
                  padding: "48px 24px",
                  textAlign: "center",
                  background: "var(--surface)",
                  borderRadius: "12px",
                  border: "1px dashed var(--border)",
                  marginTop: "12px",
                }}
              >
                <div style={{ fontSize: "36px", marginBottom: "12px" }}>🎙️</div>
                <h3 style={{ fontSize: "18px", fontWeight: 600, margin: "0 0 8px" }}>
                  Chưa có mẫu giọng nào được tạo
                </h3>
                <p
                  style={{
                    color: "var(--muted)",
                    fontSize: "14px",
                    maxWidth: "460px",
                    margin: "0 auto 20px",
                    lineHeight: 1.5,
                  }}
                >
                  Đăng ký mẫu giọng (10 - 25s) của bạn và đồng nghiệp để hệ thống Speechmatics tự
                  động nhận diện chính xác và gán tên người phát biểu trong tất cả các cuộc họp.
                </p>
                <Button
                  tone="dark"
                  onClick={() => setCreateModalOpen(true)}
                  style={{ padding: "10px 20px", fontSize: "14px", fontWeight: 600 }}
                >
                  + Thêm mẫu giọng người nói đầu tiên
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal create speaker */}
      <VoiceEnrollmentModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onEnrolled={(newProfile) => {
          setProfiles((prev) => [newProfile, ...prev]);
        }}
        isSpeakerMode={true}
      />

      {/* Modal add sample */}
      {sampleModalProfile && (
        <VoiceEnrollmentModal
          isOpen={true}
          onClose={() => setSampleModalProfile(null)}
          onEnrolled={(updated) => {
            setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            // Invalidate audio cache so newly appended audio is fetched
            audioCacheRef.current.delete(updated.id);
            setSampleModalProfile(null);
          }}
          profileId={sampleModalProfile.id}
          defaultName={sampleModalProfile.name}
          currentSampleCount={sampleModalProfile.sample_count}
          isSpeakerMode={true}
        />
      )}

      {/* Confirmation modal for delete */}
      {confirmDeleteProfile && (
        <div className="dialog-backdrop">
          <div className="dialog" style={{ width: 420 }}>
            <button
              className="close"
              aria-label="Đóng"
              onClick={() => setConfirmDeleteProfile(null)}
            >
              <Icon name="close" />
            </button>
            <h2 style={{ fontSize: "18px", fontWeight: 600 }}>Xác nhận xóa mẫu giọng</h2>
            <p style={{ marginTop: "8px", fontSize: "14px", color: "var(--muted)", lineHeight: 1.5 }}>
              Bạn có chắc chắn muốn xóa mẫu giọng của{" "}
              <strong>"{confirmDeleteProfile.name}"</strong>? Hệ thống sẽ không thể tự động nhận
              diện người nói này trong các cuộc họp tiếp theo.
            </p>
            <div className="form-actions" style={{ marginTop: "24px" }}>
              <Button
                tone="light"
                onClick={() => setConfirmDeleteProfile(null)}
                disabled={deletingId !== null}
              >
                Hủy bỏ
              </Button>
              <Button
                tone="danger"
                onClick={() => void handleDelete(confirmDeleteProfile)}
                disabled={deletingId !== null}
              >
                {deletingId ? "Đang xóa…" : "Xác nhận xóa"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
