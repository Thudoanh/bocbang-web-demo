import { useState, useRef, useEffect } from "react";
import { voiceProfilesApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { Button, Empty, Failure, Icon, Loading, PageHeading } from "../components/ui";
import { VoiceEnrollmentModal } from "../components/VoiceEnrollmentModal";
import type { VoiceProfile } from "../types/domain";

// Helper color palette for avatars
const AVATAR_COLORS = [
  "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
  "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
  "linear-gradient(135deg, #10b981 0%, #059669 100%)",
  "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
  "linear-gradient(135deg, #ec4899 0%, #db2777 100%)",
  "linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export function VoiceProfilesPage() {
  const profilesQuery = useAsync(() => voiceProfilesApi.list(), []);
  const [profiles, setProfiles] = useState<VoiceProfile[]>([]);
  const [search, setSearch] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [sampleModalTarget, setSampleModalTarget] = useState<{
    profile: VoiceProfile;
    targetIndex: number;
  } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteProfile, setConfirmDeleteProfile] = useState<VoiceProfile | null>(null);

  // Audio playback state - keyed by `${profileId}_${sampleIndex}`
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [loadingAudioKey, setLoadingAudioKey] = useState<string | null>(null);
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

  const handlePlaySample = async (profile: VoiceProfile, sampleIndex: number) => {
    setAudioError(null);
    const key = `${profile.id}_${sampleIndex}`;

    // If currently playing this sample, toggle pause
    if (playingKey === key && currentAudioRef.current) {
      currentAudioRef.current.pause();
      setPlayingKey(null);
      return;
    }

    // Stop currently playing audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
      setPlayingKey(null);
    }

    try {
      let objectUrl = audioCacheRef.current.get(key);
      if (!objectUrl) {
        setLoadingAudioKey(key);
        const blob = await voiceProfilesApi.getAudioBlob(profile.id, sampleIndex);
        objectUrl = URL.createObjectURL(blob);
        audioCacheRef.current.set(key, objectUrl);
      }

      const audio = new Audio(objectUrl);
      currentAudioRef.current = audio;

      audio.onplay = () => {
        setPlayingKey(key);
        setLoadingAudioKey(null);
      };

      audio.onended = () => {
        setPlayingKey(null);
        currentAudioRef.current = null;
      };

      audio.onerror = () => {
        setAudioError(`Không thể phát âm thanh Mẫu ${sampleIndex} của ${profile.name}.`);
        setPlayingKey(null);
        setLoadingAudioKey(null);
        currentAudioRef.current = null;
      };

      await audio.play();
    } catch (cause) {
      setAudioError(
        (cause as Error).message ||
          `Không thể tải file âm thanh Mẫu ${sampleIndex} của ${profile.name}.`
      );
      setPlayingKey(null);
      setLoadingAudioKey(null);
    }
  };

  const handleDelete = async (profile: VoiceProfile) => {
    setDeletingId(profile.id);
    try {
      await voiceProfilesApi.delete(profile.id);
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id));
      setConfirmDeleteProfile(null);
      if (playingKey && playingKey.startsWith(profile.id) && currentAudioRef.current) {
        currentAudioRef.current.pause();
        setPlayingKey(null);
      }
      // Clean up cached audio URLs for this profile
      for (let idx = 1; idx <= 3; idx++) {
        const k = `${profile.id}_${idx}`;
        const u = audioCacheRef.current.get(k);
        if (u) {
          URL.revokeObjectURL(u);
          audioCacheRef.current.delete(k);
        }
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

  const totalSamples = profiles.reduce((sum, p) => sum + (p.sample_count || 1), 0);

  return (
    <>
      <PageHeading
        title="Mẫu giọng"
        description="Đăng ký mẫu giọng để hệ thống tự động nhận diện và gán tên người phát biểu trong mọi cuộc họp."
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
              borderRadius: "10px",
            }}
          >
            <Icon name="plus" />
            + Thêm người nói mới
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
            marginBottom: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <span style={{ fontSize: "18px" }}>🎙️</span>
            <strong style={{ fontSize: "15px" }}>Danh sách người nói</strong>
            {profiles.length > 0 && (
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  padding: "3px 10px",
                  borderRadius: "999px",
                  background: "var(--surface-soft, #f1f5f9)",
                  color: "var(--muted, #64748b)",
                  border: "1px solid var(--border, #e2e8f0)",
                }}
              >
                {profiles.length} người · {totalSamples} mẫu giọng
              </span>
            )}
          </div>

          {profiles.length > 0 && (
            <div style={{ width: "280px" }}>
              <input
                type="text"
                placeholder="🔍 Tìm theo tên người nói…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--border, #cbd5e1)",
                  fontSize: "13px",
                  background: "var(--surface, #ffffff)",
                  color: "inherit",
                  boxSizing: "border-box",
                }}
              />
            </div>
          )}
        </div>

        {/* Global audio error message */}
        {audioError && (
          <div
            style={{
              padding: "10px 14px",
              marginBottom: "16px",
              backgroundColor: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: "10px",
              color: "#b91c1c",
              fontSize: "13px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>⚠️ {audioError}</span>
            <button
              onClick={() => setAudioError(null)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#b91c1c",
                fontWeight: 700,
              }}
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
                  gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))",
                  gap: "20px",
                }}
              >
                {filtered.map((profile) => {
                  const initials = profile.name
                    .split(/\s+/)
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase();

                  const count = Math.max(1, profile.sample_count || 1);
                  const isFull = count >= 3;

                  return (
                    <article
                      key={profile.id}
                      style={{
                        padding: "18px 20px",
                        background: "var(--surface, #ffffff)",
                        borderRadius: "16px",
                        border: "1px solid var(--border, #e2e8f0)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.04)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "14px",
                        transition: "box-shadow 0.15s ease",
                      }}
                    >
                      {/* Top row: Avatar, Name, Progress Badge & Delete icon */}
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "12px",
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
                          <div
                            style={{
                              width: "42px",
                              height: "42px",
                              borderRadius: "12px",
                              background: getAvatarColor(profile.name),
                              color: "#ffffff",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "15px",
                              fontWeight: 700,
                              flexShrink: 0,
                              boxShadow: "0 2px 6px rgba(0,0,0,0.12)",
                            }}
                          >
                            {initials}
                          </div>

                          <div style={{ minWidth: 0 }}>
                            <strong
                              style={{
                                fontSize: "16px",
                                fontWeight: 700,
                                display: "block",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                color: "var(--text, #0f172a)",
                              }}
                              title={profile.name}
                            >
                              {profile.name}
                            </strong>
                            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                              <span
                                style={{
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  padding: "2px 8px",
                                  borderRadius: "999px",
                                  background: isFull ? "#ecfdf5" : "#f1f5f9",
                                  color: isFull ? "#059669" : "#64748b",
                                  border: isFull ? "1px solid #a7f3d0" : "1px solid #e2e8f0",
                                }}
                              >
                                {isFull ? "✓ Đủ 3/3 mẫu" : `Đã thu ${count}/3 mẫu`}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Delete speaker button */}
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteProfile(profile)}
                          disabled={deletingId === profile.id}
                          style={{
                            background: "none",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--muted, #94a3b8)",
                            padding: "6px",
                            borderRadius: "8px",
                            display: "flex",
                            alignItems: "center",
                            transition: "color 0.15s",
                          }}
                          title="Xóa người nói này"
                          onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted, #94a3b8)")}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>

                      {/* Visual 3-bar progress indicator */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr 1fr 1fr",
                          gap: "6px",
                          marginTop: "-4px",
                        }}
                      >
                        {[1, 2, 3].map((slotIdx) => (
                          <div
                            key={slotIdx}
                            style={{
                              height: "4px",
                              borderRadius: "999px",
                              backgroundColor:
                                slotIdx <= count
                                  ? "#10b981"
                                  : "var(--border, #e2e8f0)",
                              transition: "background-color 0.2s",
                            }}
                          />
                        ))}
                      </div>

                      {/* Separator */}
                      <div style={{ height: "1px", backgroundColor: "var(--border, #f1f5f9)" }} />

                      {/* 3 Separate Voice Sample Slots */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {[1, 2, 3].map((slotIndex) => {
                          const hasSample = slotIndex <= count;
                          const isNextSlot = slotIndex === count + 1;
                          const sampleKey = `${profile.id}_${slotIndex}`;
                          const isPlayingThis = playingKey === sampleKey;
                          const isLoadingThis = loadingAudioKey === sampleKey;

                          if (hasSample) {
                            // Enrolled sample slot with its own Play/Pause button
                            return (
                              <div
                                key={slotIndex}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "9px 12px",
                                  borderRadius: "10px",
                                  backgroundColor: isPlayingThis
                                    ? "#f5f3ff"
                                    : "var(--surface-soft, #f8fafc)",
                                  border: isPlayingThis
                                    ? "1px solid #c7d2fe"
                                    : "1px solid var(--border, #e2e8f0)",
                                  transition: "all 0.15s ease",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ fontSize: "14px" }}>🎙️</span>
                                  <strong
                                    style={{
                                      fontSize: "13px",
                                      color: isPlayingThis ? "#4f46e5" : "inherit",
                                    }}
                                  >
                                    Mẫu {slotIndex}
                                  </strong>
                                  <span
                                    style={{
                                      fontSize: "11px",
                                      color: "#059669",
                                      backgroundColor: "#ecfdf5",
                                      padding: "1px 6px",
                                      borderRadius: "6px",
                                      fontWeight: 500,
                                    }}
                                  >
                                    Đã thu
                                  </span>
                                </div>

                                <Button
                                  onClick={() => void handlePlaySample(profile, slotIndex)}
                                  disabled={isLoadingThis}
                                  style={{
                                    minHeight: "30px",
                                    padding: "3px 12px",
                                    fontSize: "12px",
                                    fontWeight: 600,
                                    borderRadius: "8px",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: "5px",
                                    background: isPlayingThis ? "#6366f1" : undefined,
                                    color: isPlayingThis ? "#ffffff" : undefined,
                                    borderColor: isPlayingThis ? "#6366f1" : undefined,
                                  }}
                                >
                                  {isLoadingThis ? (
                                    "Đang tải…"
                                  ) : isPlayingThis ? (
                                    <>
                                      <span>⏸</span> Tạm dừng
                                    </>
                                  ) : (
                                    <>
                                      <span>▶</span> Nghe
                                    </>
                                  )}
                                </Button>
                              </div>
                            );
                          }

                          if (isNextSlot) {
                            // Slot ready to be recorded
                            return (
                              <button
                                key={slotIndex}
                                type="button"
                                onClick={() =>
                                  setSampleModalTarget({
                                    profile,
                                    targetIndex: slotIndex,
                                  })
                                }
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "9px 12px",
                                  borderRadius: "10px",
                                  border: "1.5px dashed var(--border, #cbd5e1)",
                                  backgroundColor: "var(--surface, #ffffff)",
                                  cursor: "pointer",
                                  textAlign: "left",
                                  color: "#6366f1",
                                  transition: "all 0.15s ease",
                                }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.borderColor = "#6366f1";
                                  e.currentTarget.style.backgroundColor = "#faf5ff";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.borderColor = "var(--border, #cbd5e1)";
                                  e.currentTarget.style.backgroundColor = "var(--surface, #ffffff)";
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <span style={{ fontSize: "14px" }}>➕</span>
                                  <strong style={{ fontSize: "13px" }}>Thu âm Mẫu {slotIndex}</strong>
                                </div>
                                <span style={{ fontSize: "12px", fontWeight: 600 }}>+ Thu mẫu</span>
                              </button>
                            );
                          }

                          // Future slot (waiting for previous slot)
                          return (
                            <div
                              key={slotIndex}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "9px 12px",
                                borderRadius: "10px",
                                border: "1px dashed var(--border, #e2e8f0)",
                                backgroundColor: "var(--surface-soft, #f8fafc)",
                                opacity: 0.5,
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ fontSize: "13px" }}>🔒</span>
                                <span style={{ fontSize: "13px", color: "var(--muted, #94a3b8)" }}>
                                  Mẫu {slotIndex} (Chưa thu)
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : profiles.length > 0 ? (
              <Empty
                title="Không tìm thấy người nói"
                detail={`Không có người nào khớp với từ khóa "${search}".`}
                action={
                  <Button tone="light" onClick={() => setSearch("")}>
                    Xóa tìm kiếm
                  </Button>
                }
              />
            ) : (
              /* Beautiful Empty State */
              <div
                style={{
                  padding: "60px 24px",
                  textAlign: "center",
                  background: "var(--surface, #ffffff)",
                  borderRadius: "16px",
                  border: "1.5px dashed var(--border, #cbd5e1)",
                  marginTop: "16px",
                  boxShadow: "0 2px 10px rgba(0, 0, 0, 0.02)",
                }}
              >
                <div
                  style={{
                    width: "64px",
                    height: "64px",
                    borderRadius: "50%",
                    backgroundColor: "#f5f3ff",
                    color: "#6366f1",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "28px",
                    margin: "0 auto 16px",
                  }}
                >
                  🎙️
                </div>
                <h3
                  style={{
                    fontSize: "19px",
                    fontWeight: 700,
                    margin: "0 0 8px",
                    color: "var(--text, #0f172a)",
                  }}
                >
                  Chưa có mẫu giọng người nói
                </h3>
                <p
                  style={{
                    color: "var(--muted, #64748b)",
                    fontSize: "14px",
                    maxWidth: "460px",
                    margin: "0 auto 24px",
                    lineHeight: 1.6,
                  }}
                >
                  Thêm mẫu giọng (10 - 25 giây) cho từng thành viên để hệ thống tự động nhận diện và
                  hiển thị tên người phát biểu trong các cuộc họp.
                </p>
                <Button
                  tone="dark"
                  onClick={() => setCreateModalOpen(true)}
                  style={{
                    padding: "11px 24px",
                    fontSize: "14px",
                    fontWeight: 600,
                    borderRadius: "10px",
                  }}
                >
                  + Thêm người nói đầu tiên
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal create speaker (Sample 1) */}
      <VoiceEnrollmentModal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onEnrolled={(newProfile) => {
          setProfiles((prev) => [newProfile, ...prev]);
        }}
        isSpeakerMode={true}
      />

      {/* Modal add sample 2 or sample 3 */}
      {sampleModalTarget && (
        <VoiceEnrollmentModal
          isOpen={true}
          onClose={() => setSampleModalTarget(null)}
          onEnrolled={(updated) => {
            setProfiles((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
            // Invalidate audio cache so newly added sample audio is freshly fetched
            const sampleKey = `${updated.id}_${sampleModalTarget.targetIndex}`;
            const oldUrl = audioCacheRef.current.get(sampleKey);
            if (oldUrl) URL.revokeObjectURL(oldUrl);
            audioCacheRef.current.delete(sampleKey);
            setSampleModalTarget(null);
          }}
          profileId={sampleModalTarget.profile.id}
          defaultName={sampleModalTarget.profile.name}
          currentSampleCount={sampleModalTarget.profile.sample_count}
          targetSampleIndex={sampleModalTarget.targetIndex}
          isSpeakerMode={true}
        />
      )}

      {/* Confirmation modal for delete */}
      {confirmDeleteProfile && (
        <div className="dialog-backdrop">
          <div className="dialog" style={{ width: 420, borderRadius: "16px" }}>
            <button
              className="close"
              aria-label="Đóng"
              onClick={() => setConfirmDeleteProfile(null)}
            >
              <Icon name="close" />
            </button>
            <h2 style={{ fontSize: "18px", fontWeight: 700 }}>Xác nhận xóa người nói</h2>
            <p
              style={{
                marginTop: "10px",
                fontSize: "14px",
                color: "var(--muted, #64748b)",
                lineHeight: 1.5,
              }}
            >
              Bạn có chắc chắn muốn xóa hồ sơ mẫu giọng của{" "}
              <strong style={{ color: "var(--text, #0f172a)" }}>
                "{confirmDeleteProfile.name}"
              </strong>
              ? Hệ thống sẽ không thể tự động nhận diện người này trong các cuộc họp tiếp theo.
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
                {deletingId ? "Đang xóa…" : "Xóa người nói"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
