import { config } from "../app/config";
import { createWavBlob } from "../realtime/wavHelper";
import { LiveShareModal } from "../components/LiveShareModal";
import { createPortal } from "react-dom";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, useMemo } from "react";
import { useAuth } from "../auth/AuthContext";
import { MeetingSocket, type RealtimeEvent } from "../realtime/meetingSocket";
import { BrowserSpeech, browserSpeechSupported } from "../realtime/browserSpeech";
import { BrowserTranscriptText } from "../components/BrowserTranscriptText";
import { SttModeSelector } from "../components/SttModeSelector";
import type { SttMode } from "../realtime/sttMode";
import { MicrophonePcmCapture } from "../realtime/microphonePcm";
import { browserDraftLabel, restoreBrowserDrafts, finishLiveTranscript, pruneStalePartials, reconcileStoredTranscript, updateLiveTranscript, type LiveTranscript, type LiveTranscriptEntry, type TranscriptEvent } from "../realtime/liveTranscript";
import { recordRender } from "../realtime/diagnostics";
import { browserRecoveryKey, nextBrowserRecovery, MAX_BROWSER_RECOVERY_ATTEMPTS } from "../realtime/liveTranscript";
import { BrowserRecoveryScheduler } from "../realtime/browserRecovery";
import { capabilitiesApi, meetingsApi, recordingApi, type TranscriptMutation } from "../api/endpoints";
import { ApiError, translateErrorMessage } from "../api/client";
import { useAsync } from "../hooks/useAsync";
import { useJobMonitor } from "../state/useJobMonitor";
import { can } from "../utils/permissions";
import { languageLabel } from "../utils/language";
import { buildTranslationMap, isUsableTranslation } from "../utils/translation";
import { formatTimestampInput, parseTimestampInput } from "../utils/time";
import type { ExportFormat, MediaFile, Meeting, Permission, Segment, Speaker, SummaryLanguage, SummaryTemplate, Transcript, Translation } from "../types/domain";
import { Button, Empty, Failure, Icon, Loading, Status, statusLabel } from "../components/ui";
import { ThemeToggle } from "../components/ThemeToggle";
import { VoiceLearningDialog } from "../components/VoiceLearningDialog";
import { TranscriptPolishDialog } from "../components/TranscriptPolishTool";
import { MeetingSectionsDialog } from "../components/MeetingSections";
import { StreamingTypewriter } from "../components/StreamingTypewriter";
import { useTranscriptPolish } from "../state/useTranscriptPolish";
import { voiceProfilesApi } from "../api/endpoints";
import type { MeetingSection, SummaryMode, SummaryScope } from "../types/domain";

function formatVietnameseDateTime(dateStr?: string | Date) {
  const d = dateStr ? new Date(dateStr) : new Date();
  const dayNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
  const dayName = dayNames[d.getDay()];
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dayName}, ${dd}-${mm}-${yyyy} lúc ${hh}:${min}`;
}

type SegmentDraft = { text: string; startTime: string; endTime: string; speakerId: string };
type AudioPlayerHandle = {
  playSegment: (startMs: number, endMs: number) => void;
  seek: (milliseconds: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  toggleMute: () => boolean;
};
type RealtimeTranslation = { text: string; sourceLanguage: string; targetLanguage: string };

const SPEAKER_PALETTE = [
  "#ec4899", // pink
  "#ef4444", // coral/red
  "#a855f7", // purple
  "#3b82f6", // blue
  "#0ea5e9", // sky
  "#f59e0b", // amber
  "#10b981", // emerald
  "#6366f1", // indigo
];

const speakerOrderMap = new Map<string, number>();

function speakerNameFromLabel(speakerLabel: string | undefined): string {
  if (!speakerLabel) return "Người nói 1";
  const raw = speakerLabel.split(":").pop()?.trim() || "";
  if (!raw || raw.toLowerCase() === "none" || raw.toLowerCase() === "unknown") return "Người nói 1";

  const match = raw.match(/^(?:speaker[_ -]?|s)(\d+)$/i);
  if (match) {
    return `Người nói ${match[1]}`;
  }

  const lower = raw.toLowerCase();
  if (!speakerOrderMap.has(lower)) {
    speakerOrderMap.set(lower, speakerOrderMap.size + 1);
  }
  return `Người nói ${speakerOrderMap.get(lower)}`;
}

function getSpeakerDisplay(
  speakerId: string | undefined,
  speakerLabel: string | undefined,
  speakers: Speaker[] = []
) {
  const found = speakerId ? speakers.find((s) => s.id === speakerId) : undefined;
  let rawName = found?.name;
  if (!rawName) {
    if (speakerLabel) {
      rawName = speakerNameFromLabel(speakerLabel);
    } else {
      rawName = "Người nói 1";
    }
  }
  if (rawName.toLowerCase().includes("không xác định") || rawName.toLowerCase().includes("chưa xác định")) {
    rawName = "Người nói 1";
  }
  // If only 1 speaker exists or was assigned "Người nói 2", normalize to "Người nói 1"
  if (speakers.length <= 1 && rawName === "Người nói 2") {
    rawName = "Người nói 1";
  }

  let hash = 0;
  const str = found?.id || rawName;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const colorIndex = Math.abs(hash) % SPEAKER_PALETTE.length;
  const color = SPEAKER_PALETTE[colorIndex];
  let initial = "1";
  if (!rawName.toLowerCase().startsWith("speaker") && !rawName.toLowerCase().startsWith("người nói")) {
    initial = rawName.trim()[0]?.toUpperCase() || "1";
  } else {
    const parts = rawName.split(" ");
    initial = parts[parts.length - 1] || "1";
  }

  return {
    name: rawName,
    initial,
    color,
  };
}

function copyToClipboard(text: string): Promise<boolean> {
  if (navigator?.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text: string): boolean {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.style.position = "fixed";
    el.style.opacity = "0";
    document.body.appendChild(el);
    el.select();
    const success = document.execCommand("copy");
    document.body.removeChild(el);
    return Boolean(success);
  } catch {
    return false;
  }
}

async function translateTextInstant(text: string, targetLang: string = "vi"): Promise<string> {
  if (!text || !text.trim() || text.trim() === "...") return "";
  const target = targetLang;

  // 1. Try backend server endpoint (zero CORS issues)
  try {
    const token = localStorage.getItem("bocbang_token");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const res = await fetch(`${config.apiBaseUrl}/translations/instant`, {
      method: "POST",
      headers,
      body: JSON.stringify({ text: text.trim(), target_language: target }),
    });
    if (res.ok) {
      const data = await res.json();
      if (isUsableTranslation(text, data?.translated)) return String(data.translated).trim();
    }
  } catch {
    // proceed to fallback
  }

  // 2. Direct client-side fallback if backend is unreachable or returned empty
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${target}&dt=t&q=${encodeURIComponent(text.trim())}`;
    const res = await fetch(url);
    if (res.ok) {
      const json = await res.json();
      if (Array.isArray(json) && Array.isArray(json[0])) {
        const translated = json[0]
          .filter((part: unknown): part is string[] => Array.isArray(part) && typeof part[0] === "string")
          .map((part: string[]) => part[0])
          .join("")
          .trim();
        if (isUsableTranslation(text, translated)) return translated;
      }
    }
  } catch {
    // ignore
  }
  return "";
}

export function MeetingPage({ meetingId }: { meetingId: string }) {
  const { user } = useAuth();

  // Modals & Drawers state (declared early for lazy loading)
  const [renameOpen, setRenameOpen] = useState(false);
  const [summaryDrawerOpen, setSummaryDrawerOpen] = useState(false);
  const [speakersDrawerOpen, setSpeakersDrawerOpen] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [playbackMode, setPlaybackMode] = useState(false);
  type ActiveMainView = "transcript" | "sections" | "polish" | "summary" | "speakers";
  const [activeMainView, setActiveMainView] = useState<ActiveMainView>("transcript");
  const [autoScroll, setAutoScroll] = useState(true);
  const [shareSocialOpen, setShareSocialOpen] = useState(false);
  const [liveShareModalOpen, setLiveShareModalOpen] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [logAiOpen, setLogAiOpen] = useState(false);
  const [voiceLearningSegment, setVoiceLearningSegment] = useState<Segment | null>(null);
  const [polishDialogOpen, setPolishDialogOpen] = useState(false);
  const [sectionsDialogOpen, setSectionsDialogOpen] = useState(false);
  const polishState = useTranscriptPolish(meetingId);
  const isAnyModalActive = Boolean(
    voiceLearningSegment ||
    logAiOpen ||
    polishDialogOpen ||
    sectionsDialogOpen ||
    exportModalOpen ||
    liveShareModalOpen ||
    shareSocialOpen ||
    renameOpen ||
    summaryDrawerOpen ||
    speakersDrawerOpen
  );

  // High-performance single-request bundle
  const bundle = useAsync(() => meetingsApi.bundle(meetingId), [meetingId]);

  const meeting: {
    data: Meeting | undefined;
    loading: boolean;
    error: Error | undefined;
    reload: () => Promise<void>;
    setData: React.Dispatch<React.SetStateAction<Meeting | undefined>>;
  } = {
    data: bundle.data?.meeting,
    loading: bundle.loading,
    error: bundle.error,
    reload: async () => {
      try {
        const nextMeeting = await meetingsApi.get(meetingId);
        bundle.setData((prev) => (prev ? { ...prev, meeting: nextMeeting } : prev));
      } catch {
        // ignore
      }
    },
    setData: (fnOrVal) => {
      bundle.setData((prev) => {
        if (!prev) return prev;
        const nextMeeting = typeof fnOrVal === "function" ? (fnOrVal as any)(prev.meeting) : fnOrVal;
        return { ...prev, meeting: nextMeeting };
      });
    },
  };

  const transcript: {
    data: Transcript | undefined;
    loading: boolean;
    error: Error | undefined;
    reload: () => Promise<void>;
    setData: React.Dispatch<React.SetStateAction<Transcript | undefined>>;
  } = {
    data: bundle.data?.transcript ?? undefined,
    loading: bundle.loading,
    error: bundle.error,
    reload: async () => {
      try {
        const nextTr = await meetingsApi.transcript(meetingId, { limit: 2000 });
        bundle.setData((prev) => (prev ? { ...prev, transcript: nextTr } : prev));
      } catch {
        // ignore
      }
    },
    setData: (fnOrVal) => {
      bundle.setData((prev) => {
        if (!prev) return prev;
        const nextTr = typeof fnOrVal === "function" ? (fnOrVal as any)(prev.transcript) : fnOrVal;
        return { ...prev, transcript: nextTr };
      });
    },
  };

  const media: {
    data: MediaFile[] | undefined;
    loading: boolean;
    error: Error | undefined;
    reload: () => Promise<void>;
    setData: React.Dispatch<React.SetStateAction<MediaFile[] | undefined>>;
  } = {
    data: bundle.data?.media,
    loading: bundle.loading,
    error: bundle.error,
    reload: async () => {
      try {
        const nextMed = await meetingsApi.media(meetingId);
        bundle.setData((prev) => (prev ? { ...prev, media: nextMed } : prev));
      } catch {
        // ignore
      }
    },
    setData: (fnOrVal) => {
      bundle.setData((prev) => {
        if (!prev) return prev;
        const nextMed = typeof fnOrVal === "function" ? (fnOrVal as any)(prev.media) : fnOrVal;
        return { ...prev, media: nextMed };
      });
    },
  };

  const speakers: {
    data: Speaker[] | undefined;
    loading: boolean;
    error: Error | undefined;
    reload: () => Promise<void>;
    setData: React.Dispatch<React.SetStateAction<Speaker[] | undefined>>;
  } = {
    data: bundle.data?.speakers,
    loading: bundle.loading,
    error: bundle.error,
    reload: async () => {
      try {
        const nextSpk = await meetingsApi.speakers(meetingId);
        bundle.setData((prev) => (prev ? { ...prev, speakers: nextSpk } : prev));
      } catch {
        // ignore
      }
    },
    setData: (fnOrVal) => {
      bundle.setData((prev) => {
        if (!prev) return prev;
        const nextSpk = typeof fnOrVal === "function" ? (fnOrVal as any)(prev.speakers) : fnOrVal;
        return { ...prev, speakers: nextSpk };
      });
    },
  };

  const translations: {
    data: Translation[] | undefined;
    loading: boolean;
    error: Error | undefined;
    reload: () => Promise<void>;
    setData: React.Dispatch<React.SetStateAction<Translation[] | undefined>>;
  } = {
    data: bundle.data?.translations,
    loading: bundle.loading,
    error: bundle.error,
    reload: async () => {
      try {
        const nextTrans = await meetingsApi.translations(meetingId);
        bundle.setData((prev) => (prev ? { ...prev, translations: nextTrans } : prev));
      } catch {
        // ignore
      }
    },
    setData: (fnOrVal) => {
      bundle.setData((prev) => {
        if (!prev) return prev;
        const nextTrans = typeof fnOrVal === "function" ? (fnOrVal as any)(prev.translations) : fnOrVal;
        return { ...prev, translations: nextTrans };
      });
    },
  };

  const summaries = useAsync(
    () => meetingsApi.summaries(meetingId),
    [meetingId]
  );

  const capabilities = useAsync(capabilitiesApi.get, []);
  const versions = useAsync(() => meetingsApi.versions(meetingId), [meetingId]);

  // Split view toggle (defaults to true)
  const [showTranslationSplit, setShowTranslationSplit] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("bocbang_show_translation");
      return saved !== null ? saved === "true" : true;
    } catch {
      return true;
    }
  });

  const toggleTranslationSplit = useCallback(() => {
    setShowTranslationSplit((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("bocbang_show_translation", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const [editing, setEditing] = useState<Segment>();
  const [draft, setDraft] = useState<SegmentDraft>({ text: "", startTime: "00:00", endTime: "00:00", speakerId: "" });
  const [notice, setNotice] = useState("");
  const [recordingActive, setRecordingActive] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState<LiveTranscript>({});
  const resolvedBrowserDrafts = useRef(new Set<string>());
  const [resolvingBrowserDraft, setResolvingBrowserDraft] = useState("");
  const browserRecoveryAttempts = useRef(new Map<string, number>());
  const [browserRecoveryTick, setBrowserRecoveryTick] = useState(0);
  const browserRecoveryScheduler = useRef(new BrowserRecoveryScheduler());
  useEffect(() => () => browserRecoveryScheduler.current.cancel(), [meetingId]);
  const finalizedBrowserTurns = useRef(new Set<string>());
  useEffect(() => {
    if (bundle.data?.browser_drafts) setLiveTranscript(current => restoreBrowserDrafts(current,
      bundle.data!.browser_drafts!.filter(d => !finalizedBrowserTurns.current.has(d.stream_segment_id))));
  }, [bundle.data?.browser_drafts]);

  // Auto-dismiss notification after 3.5 seconds
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);



  // Segment operations
  const [pendingDelete, setPendingDelete] = useState<Segment>();
  const [pendingSplit, setPendingSplit] = useState<Segment>();
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [pendingMerge, setPendingMerge] = useState<Segment[]>();
  const [activeSegmentId, setActiveSegmentId] = useState<string>();
  const [rowMenuOpenId, setRowMenuOpenId] = useState<string | null>(null);
  const [rightRowMenuOpenId, setRightRowMenuOpenId] = useState<string | null>(null);

  // Realtime translations with localStorage persistence across F5/page refresh
  const [realtimeTranslations, setRealtimeTranslations] = useState<Record<string, RealtimeTranslation>>(() => {
    try {
      const cached = localStorage.getItem(`bocbang_translations_${meetingId}`);
      return cached ? JSON.parse(cached) : {};
    } catch {
      return {};
    }
  });
  const [showRealtimeTranslations, setShowRealtimeTranslations] = useState(false);

  const handleTranslationReceived = useCallback((logicalSegmentId: string, translation: RealtimeTranslation) => {
    setRealtimeTranslations((current) => {
      const next = { ...current, [logicalSegmentId]: translation };
      try {
        localStorage.setItem(`bocbang_translations_${meetingId}`, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, [meetingId]);

  const handleMultipleTranslationsReceived = useCallback((batch: Record<string, RealtimeTranslation>) => {
    setRealtimeTranslations((current) => {
      const next = { ...current, ...batch };
      try {
        localStorage.setItem(`bocbang_translations_${meetingId}`, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, [meetingId]);

  // Translation generation in split view
  const translationJobs = useJobMonitor();
  const [targetLang, setTargetLang] = useState<string>("en");

  useEffect(() => {
    if (meeting.data?.language_mode) {
      const mode = meeting.data.language_mode.toLowerCase();
      setTargetLang(mode.startsWith("en") ? "vi" : "en");
    }
  }, [meeting.data?.language_mode]);
  const [translationError, setTranslationError] = useState("");
  const latestTranslation: Translation | undefined = translations.data?.[0];

  // Combined translation map from all server translations + localStorage cache
  const translationMap = useMemo(
    () => buildTranslationMap(transcript.data?.segments ?? [], translations.data ?? [], realtimeTranslations),
    [transcript.data?.segments, translations.data, realtimeTranslations],
  );

  // Chronological order (earliest to latest) matching screenshot
  const orderedSegments = useMemo(
    () => (transcript.data?.segments ? [...transcript.data.segments].sort((a, b) => a.start_ms - b.start_ms) : []),
    [transcript.data?.segments]
  );

  // Reverse display segments during active recording so newest is on top; chronological when finished
  const displaySegments = useMemo(
    () => (recordingActive ? [...orderedSegments].reverse() : orderedSegments),
    [recordingActive, orderedSegments]
  );

  // Synchronize all server translations into localStorage cache
  useEffect(() => {
    if (translations.data && translations.data.length > 0) {
      const batch: Record<string, RealtimeTranslation> = {};
      const sourceTexts = new Map((transcript.data?.segments ?? []).map(segment => [segment.logical_segment_id, segment.text]));
      for (const trans of [...translations.data].reverse()) {
        if (trans.segments) {
          for (const seg of trans.segments) {
            const source = sourceTexts.get(seg.logical_segment_id);
            if (source !== undefined && isUsableTranslation(source, seg.text)) {
              batch[seg.logical_segment_id] = {
                text: seg.text,
                sourceLanguage: trans.source_language || "vi",
                targetLanguage: trans.target_language || "en",
              };
            }
          }
        }
      }
      if (Object.keys(batch).length > 0) {
        handleMultipleTranslationsReceived(batch);
      }
    }
  }, [translations.data, transcript.data?.segments, handleMultipleTranslationsReceived]);
  const isTranslating = ["queued", "processing", "retrying"].includes(translationJobs.job?.status ?? "");

  const triggerTranslation = useCallback(async () => {
    if (!transcript.data?.segments?.length) return;
    try {
      setTranslationError("");
      const meetingLang = meeting.data?.language_mode || transcript.data?.language || "vi";
      const source = meetingLang.toLowerCase().startsWith("en") ? "en" : "vi";
      const target = source === "vi" ? "en" : "vi";
      const job = await meetingsApi.translation(meetingId, source, target);
      translationJobs.track(job);
    } catch (err) {
      const code = (err as any)?.code;
      const msg = (err as Error).message;
      setTranslationError(translateErrorMessage(code, msg || "Không thể khởi động dịch vụ dịch."));
    }
  }, [transcript.data?.segments?.length, transcript.data?.language, meeting.data?.language_mode, meetingId, translationJobs]);

  const player = useRef<AudioPlayerHandle>(null);
  const liveAudioChunksRef = useRef<ArrayBuffer[]>([]);
  const [liveAudioBlobUrl, setLiveAudioBlobUrl] = useState<string>("");

  const ensureLiveAudioReady = useCallback((onReady?: (url: string) => void) => {
    if (media.data?.[0]) {
      onReady?.("");
      return;
    }
    if (liveAudioChunksRef.current.length > 0) {
      const blob = createWavBlob(liveAudioChunksRef.current, 16000, 1);
      const url = URL.createObjectURL(blob);
      setLiveAudioBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return url;
      });
      onReady?.(url);
    } else {
      void meetingsApi.streamRecordingAudio(meetingId).then((blob) => {
        if (blob && blob.size > 44) {
          const url = URL.createObjectURL(blob);
          setLiveAudioBlobUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
          onReady?.(url);
        } else {
          onReady?.("");
        }
      }).catch(() => onReady?.(""));
    }
  }, [media.data, meetingId]);

  const activeClipAudioRef = useRef<HTMLAudioElement | null>(null);

  const handlePlaySegment = useCallback(
    async (startMs: number, endMs: number, segmentId?: string) => {
      if (activeClipAudioRef.current) {
        activeClipAudioRef.current.pause();
        activeClipAudioRef.current = null;
      }
      player.current?.pause();
      if (segmentId) setActiveSegmentId(segmentId);

      try {
        const blob = await meetingsApi.audioClip(meetingId, startMs, endMs);
        if (blob && blob.size > 100) {
          const url = URL.createObjectURL(blob);
          const clipAudio = new Audio(url);
          activeClipAudioRef.current = clipAudio;
          clipAudio.onended = () => {
            URL.revokeObjectURL(url);
            if (activeClipAudioRef.current === clipAudio) {
              activeClipAudioRef.current = null;
            }
            setActiveSegmentId(undefined);
          };
          clipAudio.onpause = () => {
            setActiveSegmentId(undefined);
          };
          await clipAudio.play();
          return;
        }
      } catch {
        // Fallback to player.playSegment
      }

      if (media.data?.[0]) {
        setPlaybackMode(true);
        player.current?.playSegment(startMs, endMs);
        return;
      }
      ensureLiveAudioReady((url) => {
        setPlaybackMode(true);
        setTimeout(() => {
          player.current?.playSegment(startMs, endMs);
        }, 100);
      });
    },
    [meetingId, media.data, ensureLiveAudioReady]
  );


  const updateRecordingState = useCallback((active: boolean) => {
    setRecordingActive(active);
    if (!active) {
      setLiveTranscript((current) =>
        meeting.data?.stt_mode === "browser" ? finishLiveTranscript(current) : Object.fromEntries(
          Object.entries(current).filter(([, event]) => event.type === "transcript.final")
        )
      );
    }
  }, [meeting.data?.stt_mode]);

  const refreshMedia = useCallback(async () => {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const items = await meetingsApi.media(meetingId);
        if (items && items.length > 0) {
          media.setData(items);
          return;
        }
      } catch {
        // ignore
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    void media.reload();
  }, [meetingId, media]);

  useEffect(() => {
    setLiveTranscript((current) => reconcileStoredTranscript(current, transcript.data?.segments ?? []));
  }, [transcript.data]);

  // Web Speech may wait through silence before confirming a result.
  useEffect(() => {
    const interval = setInterval(() => {
      setLiveTranscript((prev) => pruneStalePartials(prev, 3000, meeting.data?.stt_mode === "browser"));
    }, 1500);
    return () => clearInterval(interval);
  }, [meeting.data?.stt_mode]);

  // Active polling for uploaded files or processing meetings until transcript is available
  useEffect(() => {
    const isProcessing =
      meeting.data?.status === "processing" ||
      meeting.data?.status === "created" ||
      (meeting.data?.source_type === "upload" && (!transcript.data?.segments || transcript.data.segments.length === 0));

    if (!isProcessing) return;

    let cancelled = false;
    let pollAttempts = 0;
    const interval = setInterval(async () => {
      if (cancelled) return;
      pollAttempts++;
      try {
        const freshBundle = await meetingsApi.bundle(meetingId, true);
        if (cancelled) return;
        bundle.setData(freshBundle);
        // Only stop polling when meeting is failed, OR completed WITH segments present, or max attempts reached
        const isDone =
          freshBundle.meeting?.status === "failed" ||
          (freshBundle.meeting?.status === "completed" && (freshBundle.transcript?.segments?.length ?? 0) > 0) ||
          pollAttempts > 120;
        if (isDone) {
          clearInterval(interval);
        }
      } catch {
        // ignore polling errors
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [meeting.data?.status, meeting.data?.source_type, transcript.data?.segments?.length, meetingId]);

  useEffect(() => {
    if (editing) {
      setDraft({
        text: editing.text,
        startTime: formatTimestampInput(editing.start_ms),
        endTime: formatTimestampInput(editing.end_ms),
        speakerId: editing.speaker_id ?? "",
      });
    }
  }, [editing]);

  const transcriptTopRef = useRef<HTMLDivElement>(null);
  const transcriptBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!autoScroll || !activeSegmentId || editing || recordingActive) return;
    document.getElementById(`segment-${activeSegmentId}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeSegmentId, editing, autoScroll, recordingActive]);

  useEffect(() => {
    if (!autoScroll || !recordingActive) return;
    window.scrollTo({ top: 0 });
  }, [recordingActive, autoScroll]);

  useEffect(() => {
    if (translationJobs.job?.status === "completed") {
      setTranslationError("");
      meetingsApi.invalidateBundle(meetingId);
      void translations.reload();
      void meetingsApi.translations(meetingId).then((data) => {
        bundle.setData((prev) => (prev ? { ...prev, translations: data } : prev));
      });
    } else if (translationJobs.job?.status === "failed") {
      const code = translationJobs.job.error?.code;
      const msg = translationJobs.job.error?.message;
      setTranslationError(translateErrorMessage(code, msg || "Không thể tạo bản dịch tự động."));
    }
  }, [translationJobs.job?.status, translationJobs.job?.error, meetingId]);

  // Auto-translate immediately when transcript is available but translation is missing or incomplete
  const autoTranslateDoneRef = useRef<string>("");
  useEffect(() => {
    if (recordingActive || meeting.data?.status === "recording") return;
    const segments = transcript.data?.segments;
    if (!segments || segments.length === 0 || isTranslating) return;

    let translatedCount = 0;
    for (const seg of segments) {
      if (translationMap.has(seg.logical_segment_id)) {
        translatedCount++;
      }
    }
    const isComplete = translatedCount >= segments.length;
    const meetingKey = `${meetingId}-${segments.length}-${translatedCount}`;

    if (!isComplete && autoTranslateDoneRef.current !== meetingKey) {
      autoTranslateDoneRef.current = meetingKey;
      void triggerTranslation();
    }
  }, [transcript.data?.segments, translationMap, isTranslating, meetingId, triggerTranslation]);

  // Completed uploads use the durable translation job, tracked above.
  useEffect(() => {
    if (meeting.data?.stt_mode !== "browser" || !can(meeting.data.permission, "edit") || resolvingBrowserDraft) {
      browserRecoveryScheduler.current.cancel();
      return;
    }
    const pending = nextBrowserRecovery(liveTranscript, browserRecoveryAttempts.current);
    if (!pending) { browserRecoveryScheduler.current.cancel(); return; }
    const [key, event] = pending;
    const attemptKey = browserRecoveryKey(event);
    const attempt = browserRecoveryAttempts.current.get(attemptKey) ?? 0;
    browserRecoveryScheduler.current.schedule(attemptKey, attempt ? Math.min(8000, 2000 * 2 ** (attempt - 1)) : 0, () => {
      browserRecoveryAttempts.current.set(attemptKey, attempt + 1);
      void resolveBrowserDraft(key, event, "recover").then(() => setBrowserRecoveryTick(value => value + 1));
    });
  }, [meeting.data?.stt_mode, meeting.data?.permission, meetingId, liveTranscript, resolvingBrowserDraft, browserRecoveryTick]);






  // Support direct modal links (?modal=share, ?modal=export, ?modal=summary, ?modal=speakers)
  useEffect(() => {
    setPlaybackMode(false);
  }, [meetingId]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const modal = params.get("modal");
    if (modal === "share") setShareSocialOpen(true);
    else if (modal === "export") setExportModalOpen(true);
    else if (modal === "summary") setSummaryDrawerOpen(true);
    else if (modal === "speakers") setSpeakersDrawerOpen(true);
  }, [meeting.data?.id]);

  // Click outside to close row menus
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (!(e.target as HTMLElement).closest(".dual-cell-actions")) {
        setRowMenuOpenId(null);
        setRightRowMenuOpenId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function applyMutation(result: TranscriptMutation, removedId?: string) {
    transcript.setData((current) => {
      if (!current) return current;
      return {
        ...current,
        version_id: result.version_id,
        version_no: result.version_no,
        segments: removedId
          ? current.segments.filter((segment) => segment.logical_segment_id !== removedId)
          : current.segments.map((segment) =>
              segment.logical_segment_id === result.segment?.logical_segment_id ? result.segment : segment
            ),
      };
    });
    void versions.reload();
  }

  async function save() {
    if (!editing) return;
    const text = draft.text.trim();
    if (!text) return setNotice("Nội dung đoạn ghi âm không được để trống.");
    const segmentToSave = editing;
    const changedSpeaker = draft.speakerId || null;
    const startMs = parseTimestampInput(draft.startTime);
    const endMs = parseTimestampInput(draft.endTime);
    if (startMs === undefined || endMs === undefined || endMs <= startMs) {
      return setNotice("Nhập thời gian theo mm:ss hoặc hh:mm:ss; mốc kết thúc phải lớn hơn mốc bắt đầu.");
    }

    setEditing(undefined);

    // Optimistic update
    transcript.setData((current) => {
      if (!current) return current;
      return {
        ...current,
        segments: current.segments.map((s) =>
          s.logical_segment_id === segmentToSave.logical_segment_id
            ? { ...s, text, start_ms: startMs, end_ms: endMs, speaker_id: changedSpeaker ?? undefined }
            : s
        ),
      };
    });

    try {
      const body: { text?: string; start_ms?: number; end_ms?: number } = {};
      if (segmentToSave.text !== text) body.text = text;
      if (
        draft.startTime !== formatTimestampInput(segmentToSave.start_ms) ||
        draft.endTime !== formatTimestampInput(segmentToSave.end_ms)
      ) {
        body.start_ms = startMs;
        body.end_ms = endMs;
      }
      if (Object.keys(body).length) await meetingsApi.saveSegment(segmentToSave.logical_segment_id, body);
      if ((segmentToSave.speaker_id ?? null) !== changedSpeaker) {
        await meetingsApi.setSegmentSpeaker(segmentToSave.logical_segment_id, changedSpeaker);
      }
      void transcript.reload();
      void versions.reload();
      setNotice("Đã lưu thay đổi.");
    } catch (cause) {
      await transcript.reload();
      setNotice(meetingErrorMessage(cause));
    }
  }

  async function handleSplit(segment: Segment, splitAt: number, first: string, second: string) {
    setPendingSplit(undefined);
    const firstSegment: Segment = { ...segment, end_ms: splitAt, text: first };
    const secondSegment: Segment = {
      ...segment,
      logical_segment_id: `temp-split-${Date.now()}`,
      start_ms: splitAt,
      text: second,
    };

    transcript.setData((current) => {
      if (!current) return current;
      const idx = current.segments.findIndex((s) => s.logical_segment_id === segment.logical_segment_id);
      if (idx === -1) return current;
      const nextSegments = [...current.segments];
      nextSegments.splice(idx, 1, firstSegment, secondSegment);
      return { ...current, segments: nextSegments };
    });

    try {
      await meetingsApi.splitSegment(segment.logical_segment_id, splitAt, first, second);
      setNotice("Đã tách đoạn thành công.");
      void transcript.reload();
      void versions.reload();
    } catch (cause) {
      await transcript.reload();
      setNotice(meetingErrorMessage(cause));
    }
  }

  async function handleMerge(selected: Segment[]) {
    const sorted = [...selected].sort((a, b) => a.start_ms - b.start_ms);
    setPendingMerge(undefined);
    setMergeIds([]);

    const primaryId = sorted[0].logical_segment_id;
    const removedIds = new Set(sorted.slice(1).map((s) => s.logical_segment_id));
    const mergedSegment: Segment = {
      ...sorted[0],
      end_ms: Math.max(...sorted.map((s) => s.end_ms)),
      text: sorted.map((s) => s.text.trim()).filter(Boolean).join(" "),
    };

    transcript.setData((current) => {
      if (!current) return current;
      const nextSegments = current.segments
        .filter((s) => !removedIds.has(s.logical_segment_id))
        .map((s) => (s.logical_segment_id === primaryId ? mergedSegment : s));
      return { ...current, segments: nextSegments };
    });

    try {
      await meetingsApi.mergeSegments(sorted.map((s) => s.logical_segment_id));
      setNotice(`Đã gộp ${sorted.length} đoạn thành công.`);
      void transcript.reload();
      void translations.reload();
      void versions.reload();
    } catch (cause) {
      await transcript.reload();
      setNotice(meetingErrorMessage(cause));
    }
  }

  async function mutate(action: () => Promise<TranscriptMutation>, success: string, removedId?: string) {
    if (removedId) {
      transcript.setData((current) => {
        if (!current) return current;
        return {
          ...current,
          segments: current.segments.filter((segment) => segment.logical_segment_id !== removedId),
        };
      });
    }
    try {
      const result = await action();
      if (removedId) applyMutation(result, removedId);
      else {
        await transcript.reload();
        await versions.reload();
      }
      setNotice(success);
    } catch (cause) {
      await transcript.reload();
      setNotice(meetingErrorMessage(cause));
    }
  }

  function toggleMerge(segment: Segment) {
    setMergeIds((current) =>
      current.includes(segment.logical_segment_id)
        ? current.filter((id) => id !== segment.logical_segment_id)
        : [...current, segment.logical_segment_id]
    );
  }

  function prepareMerge() {
    const selected = orderedSegments.filter((item) => mergeIds.includes(item.logical_segment_id));
    if (selected.length < 2) return setNotice("Chọn ít nhất hai đoạn để gộp.");
    const indexes = selected
      .map((item) => orderedSegments.findIndex((segment) => segment.logical_segment_id === item.logical_segment_id))
      .sort((a, b) => a - b);
    for (let i = 1; i < indexes.length; i++) {
      if (indexes[i] !== indexes[i - 1] + 1) {
        return setNotice("Các đoạn được chọn phải nằm liền kề nhau.");
      }
    }
    setPendingMerge(selected);
  }



  if (meeting.loading) {
    return (
      <div className="meeting-page-container" style={{ padding: 32, display: "flex", justifyContent: "center", alignItems: "center", minHeight: "50vh" }}>
        <Loading label="Đang tải phiên họp..." />
      </div>
    );
  }
  if (meeting.error || !meeting.data)
    return <Failure error={meeting.error ?? new Error("Không tìm thấy cuộc họp.")} retry={meeting.reload} />;

  const editable = can(meeting.data.permission, "edit");
  const owner = meeting.data.permission === "owner";
  const realtimeTarget =
    meeting.data.language_mode === "auto" || meeting.data.language_mode === "vi"
      ? "en"
      : meeting.data.language_mode === "en"
      ? "vi"
      : "en";
  const translationPairs = capabilities.data?.translation.language_pairs ?? [];
  const realtimeTranslationSupported =
    meeting.data.language_mode === "auto"
      ? [["vi", "en"], ["en", "vi"]].every(([source, target]) =>
          translationPairs.some(([from, to]) => from === source && to === target)
        )
      : Boolean(
          realtimeTarget &&
            translationPairs.some(([source, target]) => source === meeting.data?.language_mode && target === realtimeTarget)
        );

  const maxStoredEndMs = Math.max(0, ...(transcript.data?.segments?.map((s) => s.end_ms) ?? [0]));

  const liveEntries = Object.entries(liveTranscript)
    .filter(([, event]) => {
      if (event.type === "transcript.final") {
        return !transcript.data?.segments?.some(
          (segment) => segment.logical_segment_id === event.logical_segment_id
        );
      }
      if (!recordingActive && event.recognition_status !== "unconfirmed" && !event.draft_saved_at) return false;
      return true; // Xuất hiện chữ ngay tức thì từng từ khi đang nói
    })
    .sort(([, a], [, b]) => a.start_ms - b.start_ms);

  async function resolveBrowserDraft(key: string, event: LiveTranscriptEntry, action: "confirm" | "discard" | "recover") {
    if (!event.stream_segment_id || event.revision === undefined) return false;
    setResolvingBrowserDraft(key);
    try {
      const resolution = await meetingsApi.resolveBrowserDraft(meetingId, { stream_segment_id: event.stream_segment_id, revision: event.revision, action });
      if (resolution.logical_segment_id && isUsableTranslation(event.text, event.translation)) {
        handleTranslationReceived(resolution.logical_segment_id, { text: event.translation!,
          sourceLanguage: event.language, targetLanguage: event.language === "en" ? "vi" : "en" });
      }
      resolvedBrowserDrafts.current.add(event.stream_segment_id);
      finalizedBrowserTurns.current.add(event.stream_segment_id);
      setLiveTranscript(current => resolution.logical_segment_id && action !== "discard"
        ? updateLiveTranscript(current, { type: "transcript.final", logical_segment_id: resolution.logical_segment_id,
            language: event.language, text: event.text, start_ms: event.start_ms, end_ms: event.end_ms,
            stream_segment_id: event.stream_segment_id, translation: event.translation })
        : Object.fromEntries(Object.entries(current).filter(([, item]) => item.stream_segment_id !== event.stream_segment_id)));
      meetingsApi.invalidateBundle(meetingId);
      bundle.setData(await meetingsApi.bundle(meetingId, true));
      if (action !== "recover") setNotice(action === "confirm" ? "Đã lưu văn bản do bạn xác nhận." : "Đã bỏ đoạn chưa xác nhận.");
      return true;
    } catch (error) {
      if (action === "recover" && (error as { code?: string }).code === "BROWSER_DRAFT_NOT_FOUND") {
        try {
          meetingsApi.invalidateBundle(meetingId);
          bundle.setData(await meetingsApi.bundle(meetingId, true));
          finalizedBrowserTurns.current.add(event.stream_segment_id);
          setLiveTranscript(current => Object.fromEntries(Object.entries(current).filter(([, item]) =>
            item.type === "transcript.final" || item.stream_segment_id !== event.stream_segment_id)));
          return true;
        } catch { return false; }
      }
      if (action !== "recover" || (browserRecoveryAttempts.current.get(browserRecoveryKey(event)) ?? 0) >= MAX_BROWSER_RECOVERY_ATTEMPTS) {
        setNotice(error instanceof Error ? error.message : "Không thể lưu văn bản Browser. Hãy kiểm tra kết nối rồi thử lại.");
      }
      return false;
    } finally { setResolvingBrowserDraft(""); }
  }

  function renderLiveEntries() {
    return (
      <>
        {liveEntries.map(([key, event]) => (
          <div key={key} className={`dual-row-pair is-live-streaming ${event.recognition_status === "unconfirmed" ? "is-unconfirmed" : event.type === "transcript.partial" ? event.draft_saved_at ? "is-saved-draft" : "is-partial" : "is-final"}`}>
            <div className="dual-cell left">
              <div className="dual-cell-main">
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  {meeting.data?.stt_mode !== "browser" && <span className="dual-speaker-name">
                    {event.speaker_name ?? speakerNameFromLabel(event.speaker_label)}:
                  </span>}
                  {(event.revision !== undefined || event.recognition_status === "unconfirmed") && (
                    <span className="browser-draft-status" style={{ color: "var(--muted)", fontSize: 12 }} title={event.draft_saved_at ? "Văn bản được tự chốt khi lượt nhận diện kết thúc." : "Đang chờ xác nhận lưu từ máy chủ."}>{
                      event.recognition_status === "unconfirmed" && !event.awaiting_final && editable
                        ? (browserRecoveryAttempts.current.get(browserRecoveryKey(event)) ?? 0) >= MAX_BROWSER_RECOVERY_ATTEMPTS && resolvingBrowserDraft !== key
                          ? "Lưu tự động chưa thành công" : "Đang hoàn tất văn bản"
                        : browserDraftLabel(event)
                    }</span>
                  )}
                </div>
                {event.revision !== undefined ? <BrowserTranscriptText text={event.text} active={event.type === "transcript.partial" && event.recognition_status !== "unconfirmed"} /> : <StreamingTypewriter
                  className="dual-text live-streaming-text"
                  text={event.text}
                  active={event.type === "transcript.partial" && event.recognition_status !== "unconfirmed"}
                />}
                {editable && meeting.data?.stt_mode === "browser" && event.recognition_status === "unconfirmed" && !event.awaiting_final &&
                  (browserRecoveryAttempts.current.get(browserRecoveryKey(event)) ?? 0) >= MAX_BROWSER_RECOVERY_ATTEMPTS && (
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                    <small style={{ color: "var(--muted)" }}>Web Speech chưa chốt đoạn này. Kiểm tra nội dung rồi chọn:</small>
                    <Button disabled={Boolean(resolvingBrowserDraft) || event.draft_saved_revision !== event.revision}
                      onClick={() => void resolveBrowserDraft(key, event, "confirm")}>Xác nhận văn bản</Button>
                    <Button disabled={Boolean(resolvingBrowserDraft) || event.draft_saved_revision !== event.revision}
                      onClick={() => void resolveBrowserDraft(key, event, "discard")}>Bỏ đoạn</Button>
                  </div>
                )}
              </div>
            </div>
            {showTranslationSplit && (
              <div className="dual-cell right">
                <div className="dual-cell-main">
                  <span className="dual-speaker-name">Bản dịch:</span>
                  <span className="dual-text">
                    {event.translation ? (
                      <StreamingTypewriter
                        className="live-streaming-text"
                        text={event.translation}
                        active={event.type === "transcript.partial" && event.recognition_status !== "unconfirmed"}
                      />
                    ) : (
                      <span style={{ color: "var(--muted)", fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
                        {event.recognition_status === "unconfirmed" ? <em>Chưa có bản dịch được xác nhận</em> : event.type === "transcript.partial" ? (
                          <>
                            <span className="record-pulsing-dot" style={{ width: 6, height: 6, background: "#38bdf8" }} />
                            <span>Đang dịch...</span>
                            <span className="streaming-cursor">▋</span>
                          </>
                        ) : (
                          <em>Đang dịch…</em>
                        )}
                      </span>
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}
      </>
    );
  }

  const hasTranscriptContent = orderedSegments.length > 0 || liveEntries.length > 0;

  const selectedMergeSegments = transcript.data?.segments.filter((segment) => mergeIds.includes(segment.logical_segment_id)) ?? [];

  const initialRecordingDurationMs = Math.max(
    meeting.data.duration_ms ?? 0,
    media.data?.[0]?.duration_ms ?? 0,
    ...(transcript.data?.segments.map((segment) => segment.end_ms) ?? [0])
  );

  // Note: translationMap is defined above using useMemo for component-wide availability
  const isRealtimeRecording =
    editable &&
    meeting.data.source_type === "realtime" &&
    meeting.data.status !== "completed" &&
    (meeting.data.stt_mode === "browser" || Boolean(capabilities.data?.stt.streaming));

  return (
    <div className="meeting-page-container">
      {/* Topbar & Breadcrumb */}
      <div className="meeting-topbar">
        <div className="topbar-left">
          {activeMainView !== "transcript" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <button
                type="button"
                className="topbar-dedicated-back-btn"
                onClick={() => setActiveMainView("transcript")}
              >
                <Icon name="back" />
                <span>Quay lại bản ghi</span>
              </button>
              <span className="topbar-dedicated-title-pill">
                {activeMainView === "polish" && "Làm mịn transcript bằng AI"}
                {activeMainView === "summary" && "Tóm tắt cuộc họp bằng AI"}
                {activeMainView === "sections" && "Bố cục phiên họp"}
                {activeMainView === "speakers" && "Quản lý người nói"}
              </span>
            </div>
          ) : (
          <div className="topbar-breadcrumb">
            <span className="topbar-breadcrumb-root">{playbackMode ? "Phát Lại Ghi Âm" : "Ghi Âm Cuộc Họp"}</span>
            <span className="topbar-breadcrumb-sep">&gt;</span>
            <span
              className="topbar-breadcrumb-title"
              onClick={() => editable && setRenameOpen(true)}
              title={editable ? "Nhấp để đổi tên" : undefined}
            >
              <span>{meeting.data.title}</span>
              {editable && <Icon name="edit" />}
            </span>
            <span
              className={`topbar-status-badge ${
                meeting.data.status === "failed" || (media.data?.[0]?.status === "failed" && meeting.data.status !== "completed")
                  ? "is-failed"
                  : meeting.data.status === "processing"
                  ? "is-processing"
                  : ""
              }`}
              style={
                meeting.data.status === "failed" || (media.data?.[0]?.status === "failed" && meeting.data.status !== "completed")
                  ? { color: "#ef4444", background: "rgba(239, 68, 68, 0.12)" }
                  : meeting.data.status === "processing"
                  ? { color: "#3b82f6", background: "rgba(59, 130, 246, 0.12)" }
                  : undefined
              }
            >
              {recordingActive
                ? "● Đang ghi âm"
                : meeting.data.status === "failed" || (media.data?.[0]?.status === "failed" && meeting.data.status !== "completed")
                ? "● Thất bại"
                : meeting.data.status === "processing"
                ? "● Đang xử lý…"
                : "● Sẵn sàng"}
            </span>
          </div>
          )}
        </div>

        <div className="topbar-right">
          <button
            type="button"
            className={`topbar-trans-toggle-btn ${showTranslationSplit ? "is-active" : ""}`}
            onClick={toggleTranslationSplit}
            title={showTranslationSplit ? "Ẩn cột bản dịch" : "Hiển thị cột bản dịch"}
          >
            <span style={{ fontSize: 13, marginRight: 4, fontWeight: 700 }}>文A</span>
            <span>{showTranslationSplit ? "Ẩn bản dịch" : "Bản dịch"}</span>
          </button>
          <ThemeToggle />
        </div>
      </div>



      {notice && (
        <div className="bocbang-floating-toast" role="status" aria-live="polite">
          <span className="toast-icon">✓</span>
          <span className="toast-message">{notice}</span>
          <button
            type="button"
            className="toast-close-btn"
            onClick={() => setNotice("")}
            aria-label="Đóng"
          >
            ×
          </button>
        </div>
      )}

      {/* Top Recording Panel moved to Docked Bottom Bar */}

      {/* Media Player (Hidden audio element + Full Bottom Player when playbackMode is on) */}
      {(media.data?.[0] || liveAudioBlobUrl || liveAudioChunksRef.current.length > 0) && (
        <MediaPlayer
          ref={player}
          meetingId={meetingId}
          mediaId={media.data?.[0]?.id || "live"}
          liveBlobUrl={liveAudioBlobUrl}
          filename={media.data?.[0]?.original_filename || "Bản ghi âm cuộc họp"}
          segments={transcript.data?.segments ?? []}
          playbackMode={playbackMode}
          onClosePlayback={() => {
            if (activeClipAudioRef.current) {
              activeClipAudioRef.current.pause();
              activeClipAudioRef.current = null;
            }
            player.current?.pause();
            setPlaybackMode(false);
            setActiveSegmentId(undefined);
          }}
          onActiveSegment={setActiveSegmentId}
          onSummary={() => setActiveMainView((prev) => prev === "summary" ? "transcript" : "summary")}
          onSpeakers={() => setActiveMainView((prev) => prev === "speakers" ? "transcript" : "speakers")}
          onShare={() => setLiveShareModalOpen(true)}
          onExport={() => setExportModalOpen(true)}
          downloadUrl={media.data?.[0] ? `/api/v1/meetings/${meetingId}/media/${media.data[0].id}/download` : undefined}
        />
      )}

      {/* FLOATING MERGE ACTION BAR (ALWAYS VISIBLE & STICKY WHEN SEGMENTS ARE SELECTED) */}
      {mergeIds.length > 0 && (
        <div className="floating-merge-toolbar">
          <div className="floating-merge-info">
            <span className="floating-merge-count-badge">{mergeIds.length}</span>
            <span className="floating-merge-text">Đã chọn {mergeIds.length} đoạn</span>
            <div className="floating-merge-chips">
              {orderedSegments.filter((s) => mergeIds.includes(s.logical_segment_id)).map((segment, index) => (
                <span
                  key={segment.logical_segment_id}
                  className="floating-merge-chip"
                  title={segment.text}
                >
                  <b>#{index + 1}</b> {segment.text.slice(0, 24)}...
                  <button
                    type="button"
                    onClick={() => toggleMerge(segment)}
                    title="Bỏ chọn"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </div>
          <div className="floating-merge-actions">
            <button
              type="button"
              className="btn-merge-action confirm"
              disabled={mergeIds.length < 2}
              onClick={prepareMerge}
              title={mergeIds.length < 2 ? "Hãy chọn thêm ít nhất 1 đoạn liền kề để gộp" : "Gộp các đoạn đã chọn"}
            >
              🔗 Gộp {mergeIds.length} đoạn
            </button>
            <button
              type="button"
              className="btn-merge-action cancel"
              onClick={() => setMergeIds([])}
              title="Hủy chọn tất cả"
            >
              Bỏ chọn
            </button>
          </div>
        </div>
      )}

      {/* Live Incoming Streaming Transcripts rendered inside dual-split-card */}



      {/* DUAL COLUMN SPLIT VIEW (Bản ghi & Bản dịch) */}
            {/* DEDICATED FULL-SCREEN FEATURE SCREENS (BỐ CỤC, LÀM MỊN, TÓM TẮT, QUẢN LÝ NGƯỜI NÓI) */}
      {activeMainView === "sections" && (
        <MeetingSectionsDialog
          meetingId={meetingId}
          close={() => setActiveMainView("transcript")}
          isFullScreen={true}
        />
      )}
      {activeMainView === "polish" && (
        <TranscriptPolishDialog
          meetingId={meetingId}
          review={polishState}
          close={() => setActiveMainView("transcript")}
          isFullScreen={true}
        />
      )}
      {activeMainView === "summary" && (
        <SummaryAiModal
          meetingId={meetingId}
          meetingTitle={meeting.data.title}
          hasTranscript={orderedSegments.length > 0}
          editable={editable}
          summaries={summaries}
          capabilities={capabilities.data}
          close={() => setActiveMainView("transcript")}
          isFullScreen={true}
        />
      )}
      {activeMainView === "speakers" && (
        <SpeakerManagementModal
          meetingId={meetingId}
          speakers={speakers}
          editable={editable}
          close={() => setActiveMainView("transcript")}
          isFullScreen={true}
        />
      )}

      {activeMainView === "transcript" && (
      <div className="meeting-content-flex">
        <div className="meeting-content-main">
          <div className={`dual-split-card ${showTranslationSplit ? "is-split" : "is-single"} ${playbackMode ? "is-playback" : ""}`}>
          {/* Clean header handled by meeting-columns-bar */}

          {translationError && (
            <div
              className="notice form-error"
              style={{
                margin: "10px 16px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                borderRadius: 8,
                padding: "10px 16px",
                background: "rgba(239, 68, 68, 0.08)",
                border: "1px solid rgba(239, 68, 68, 0.25)",
                color: "#dc2626",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 16 }}>⚠️</span>
                <span>
                  <strong>Lỗi dịch thuật:</strong> {translationError}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-ghost"
                style={{
                  height: 28,
                  padding: "2px 12px",
                  fontSize: 12,
                  borderRadius: 6,
                  background: "#ef4444",
                  color: "#fff",
                  border: 0,
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                onClick={() => void triggerTranslation()}
              >
                Thử dịch lại
              </button>
            </div>
          )}

          {/* Rows: Side-by-side segment pairs OR Modern Empty State */}
          {!hasTranscriptContent ? (
            meeting.data?.status === "failed" || (media.data?.[0]?.status === "failed" && meeting.data?.status !== "completed") ? (
              <div className="modern-empty-state">
                <div className="empty-state-soundwave-icon" style={{ color: "#ef4444" }}>
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <h3 className="empty-state-title" style={{ color: "#dc2626" }}>
                  Xử lý tệp âm thanh thất bại
                </h3>
                <p className="empty-state-desc">
                  {media.data?.[0]?.error_message || "Không thể chuyển đổi hoặc bóc băng tệp ghi âm này (có thể do tệp bị lỗi hoặc định dạng âm thanh không hợp lệ)."}
                </p>
                <div style={{ marginTop: 16 }}>
                  <a className="btn btn-dark" href="/meetings?mode=upload">
                    Tải tệp khác
                  </a>
                </div>
              </div>
            ) : (meeting.data?.stt_mode !== "browser" && (meeting.data?.status === "processing" || meeting.data?.status === "created")) || (meeting.data?.source_type === "upload" && (!transcript.data?.segments || transcript.data.segments.length === 0) && meeting.data?.status !== "completed") ? (
              <div className="modern-empty-state">
                <div className="empty-state-soundwave-icon">
                  <span className="record-pulsing-dot" style={{ width: 18, height: 18, background: "#38bdf8" }} />
                </div>
                <h3 className="empty-state-title">Đang xử lý…</h3>
                <p className="empty-state-desc">
                  Vui lòng đợi trong giây lát.
                </p>
              </div>
            ) : (
              <div className="modern-empty-state">
                <div className="empty-state-soundwave-icon">
                  {recordingActive ? (
                    <span className="record-pulsing-dot red" style={{ width: 18, height: 18 }} />
                  ) : (
                    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                  )}
                </div>
                <h3 className="empty-state-title">
                  {recordingActive ? "Đang lắng nghe âm thanh…" : "Sẵn sàng ghi âm cuộc họp"}
                </h3>
                <p className="empty-state-desc">
                  {recordingActive
                    ? "Hãy nói vào microphone, nội dung nhận diện và bản dịch sẽ hiển thị đồng bộ tại đây."
                    : "Bấm nút Bắt đầu ghi âm ở thanh công cụ bên dưới hoặc tải lên tệp âm thanh sẵn có để tự động chuyển văn bản và dịch song song."}
                </p>
                {!recordingActive && (
                  <button
                    type="button"
                    className="modern-empty-start-btn"
                    onClick={() => window.dispatchEvent(new CustomEvent("bocbang:start-recording"))}
                  >
                    <Icon name="microphone" />
                    <span>Ghi âm cuộc họp</span>
                  </button>
                )}
              </div>
            )
          ) : (
            <div className="dual-rows-wrapper">
              <div ref={transcriptTopRef} style={{ height: 0, minHeight: 0, pointerEvents: "none" }} />
              {/* When recording: Live incoming entries appear at the TOP */}
              {recordingActive && renderLiveEntries()}
              {displaySegments.map((segment, segIdx) => {
              const nextSegment = segIdx < displaySegments.length - 1 ? displaySegments[segIdx + 1] : null;
              const isPlaying = activeSegmentId === segment.logical_segment_id;
              const isMergeSelected = mergeIds.includes(segment.logical_segment_id);
              const isEditing = editing?.logical_segment_id === segment.logical_segment_id;
              const speakerInfo = getSpeakerDisplay(segment.speaker_id, segment.speaker_label, speakers.data);

              const rawTransText = translationMap.get(segment.logical_segment_id);
              const transText = rawTransText?.trim() || undefined;

              const isRowMenuOpen = rowMenuOpenId === segment.logical_segment_id;

              return (
                <div
                  key={segment.logical_segment_id}
                  id={`segment-${segment.logical_segment_id}`}
                  className={`dual-row-pair ${isPlaying ? "is-playing" : ""} ${
                    isMergeSelected ? "is-merge-selected" : ""
                  } ${mergeIds.length > 0 ? "is-in-merge-mode" : ""}`}
                  onClick={(e) => {
                    if (mergeIds.length > 0) {
                      const target = e.target as HTMLElement;
                      if (!target.closest("button, textarea, input, select, .dual-row-menu-dropdown")) {
                        toggleMerge(segment);
                      }
                    }
                  }}
                >
                  {/* Left Cell: Transcript */}
                  <div className="dual-cell left">
                    {/* Checkbox for merge selection (hover-visible when 0 selected, always visible in merge mode) */}
                    {editable && (
                      <button
                        type="button"
                        className={`row-merge-checkbox ${isMergeSelected ? "is-checked" : ""} ${
                          mergeIds.length > 0 ? "in-merge-mode" : "hover-only"
                        }`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleMerge(segment);
                        }}
                        title={isMergeSelected ? "Bỏ chọn đoạn này" : "Chọn gộp đoạn này"}
                      >
                        {isMergeSelected ? <Icon name="check" /> : null}
                      </button>
                    )}

                    {isEditing ? (
                      <div className="editor" style={{ flex: 1 }}>
                        <label>
                          Nội dung
                          <textarea
                            value={draft.text}
                            onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                          />
                        </label>
                        <div className="segment-time-fields">
                          <label>
                            Bắt đầu (mm:ss)
                            <input
                              inputMode="numeric"
                              value={draft.startTime}
                              onChange={(event) => setDraft({ ...draft, startTime: event.target.value })}
                            />
                          </label>
                          <label>
                            Kết thúc (mm:ss)
                            <input
                              inputMode="numeric"
                              value={draft.endTime}
                              onChange={(event) => setDraft({ ...draft, endTime: event.target.value })}
                            />
                          </label>
                        </div>
                        <label>
                          Người nói
                          <select
                            value={draft.speakerId}
                            onChange={(event) => setDraft({ ...draft, speakerId: event.target.value })}
                          >
                            <option value="">Chưa xác định</option>
                            {speakers.data?.map((spk) => (
                              <option key={spk.id} value={spk.id}>
                                {spk.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <div className="form-actions">
                          <Button onClick={() => setEditing(undefined)}>Hủy</Button>
                          <Button tone="dark" onClick={() => void save()}>
                            Lưu
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="dual-cell-main">
                          <span className="dual-speaker-name">
                            {meeting.data?.stt_mode !== "browser" && <>{speakerInfo.name}:</>}
                            {isMergeSelected && (
                              <span className="merge-row-selected-badge">✓ Đã chọn</span>
                            )}
                          </span>
                          <span className="dual-text">{segment.text}</span>
                          <div className="sentence-hover-actions">
                            <span className="sentence-hover-time">
                              {formatTime(segment.start_ms)} - {formatTime(segment.end_ms)}
                            </span>
                            <button
                              type="button"
                              className="sentence-hover-btn"
                              onClick={() => {
                                handlePlaySegment(segment.start_ms, segment.end_ms, segment.logical_segment_id);
                              }}
                              title={`Phát câu này (${formatTime(segment.start_ms)} - ${formatTime(segment.end_ms)})`}
                            >
                              ▷ Phát
                            </button>
                          </div>
                        </div>

                        {/* Three-dot menu */}
                        <div className="dual-cell-actions">
                          <button
                            type="button"
                            className={`dual-more-btn ${isRowMenuOpen ? "active" : ""}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setRowMenuOpenId(isRowMenuOpen ? null : segment.logical_segment_id);
                            }}
                            title="Tùy chọn đoạn"
                          >
                            <Icon name="more" />
                          </button>

                          {isRowMenuOpen && (
                            <div className="dual-row-menu-dropdown">
                              {editable && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRowMenuOpenId(null);
        setRightRowMenuOpenId(null);
                                    setVoiceLearningSegment(segment);
                                  }}
                                  title="Lấy mẫu giọng từ đoạn ghi âm này để nhận diện người nói"
                                >
                                  <Icon name="microphone" />
                                  <span>Gán mẫu giọng</span>
                                </button>
                              )}
                              {editable && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRowMenuOpenId(null);
        setRightRowMenuOpenId(null);
                                    setEditing(segment);
                                  }}
                                >
                                  <Icon name="edit" />
                                  <span>Sửa</span>
                                </button>
                              )}
                              {editable && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRowMenuOpenId(null);
        setRightRowMenuOpenId(null);
                                    setPendingSplit(segment);
                                  }}
                                >
                                  <span>✂ Tách đoạn</span>
                                </button>
                              )}
                              {editable && nextSegment && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRowMenuOpenId(null);
                                    setRightRowMenuOpenId(null);
                                    setPendingMerge([segment, nextSegment]);
                                  }}
                                  title={`Gộp ngay với đoạn dưới: "${nextSegment.text.slice(0, 30)}..."`}
                                >
                                  <span>🔗 Gộp với đoạn dưới</span>
                                </button>
                              )}
                              {editable && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRowMenuOpenId(null);
                                    setRightRowMenuOpenId(null);
                                    toggleMerge(segment);
                                  }}
                                >
                                  <span>{isMergeSelected ? "✕ Bỏ chọn gộp" : "☑ Chọn gộp nhiều đoạn"}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setRowMenuOpenId(null);
        setRightRowMenuOpenId(null);
                                  void copyToClipboard(segment.text);
                                  setNotice("Đã sao chép nội dung.");
                                }}
                              >
                                <Icon name="copy" />
                                <span>Sao chép</span>
                              </button>
                              {editable && (
                                <button
                                  type="button"
                                  className="text-danger"
                                  onClick={() => {
                                    setRowMenuOpenId(null);
        setRightRowMenuOpenId(null);
                                    setPendingDelete(segment);
                                  }}
                                >
                                  <Icon name="trash" />
                                  <span>Xóa</span>
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Right Cell: Translation (if showTranslationSplit) */}
                  {showTranslationSplit && (
                    <div className="dual-cell right">
                      <div className="dual-cell-main">
                        {meeting.data?.stt_mode !== "browser" && <span className="dual-speaker-name">{speakerInfo.name}:</span>}
                        <span className="dual-text">
                          {transText ? (
                            transText
                          ) : (isTranslating && !recordingActive) ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--primary-color, #2563eb)", fontSize: 13, fontWeight: 500 }}>
                              <span className="record-pulsing-dot" style={{ width: 6, height: 6, background: "#38bdf8" }} />
                              Đang tự động dịch…
                            </span>
                          ) : translationError ? (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#dc2626", fontSize: 13 }}>
                              <em>Chưa có bản dịch (Lỗi: {translationError})</em>
                              {editable && (
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ padding: "2px 8px", fontSize: 11, height: 24, borderRadius: 4, color: "#dc2626", border: "1px solid rgba(220, 38, 38, 0.3)" }}
                                  onClick={async () => {
                                    const tr = await translateTextInstant(segment.text, targetLang);
                                    if (tr) handleTranslationReceived(segment.logical_segment_id, { text: tr, sourceLanguage: "auto", targetLanguage: targetLang });
                                  }}
                                >
                                  Dịch ngay
                                </button>
                              )}
                            </span>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                              <em style={{ color: "var(--muted)", fontSize: 13 }}>Chưa có bản dịch</em>
                              {editable && (
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  style={{ padding: "2px 8px", fontSize: 11, height: 24, borderRadius: 4 }}
                                  onClick={async () => {
                                    const tr = await translateTextInstant(segment.text, targetLang);
                                    if (tr) handleTranslationReceived(segment.logical_segment_id, { text: tr, sourceLanguage: "auto", targetLanguage: targetLang });
                                  }}
                                >
                                  Dịch ngay
                                </button>
                              )}
                            </span>
                          )}
                        </span>
                        <div className="sentence-hover-actions">
                          <span className="sentence-hover-time">
                            {formatTime(segment.start_ms)} - {formatTime(segment.end_ms)}
                          </span>
                          <button
                            type="button"
                            className="sentence-hover-btn"
                            onClick={() => {
                              handlePlaySegment(segment.start_ms, segment.end_ms, segment.logical_segment_id);
                            }}
                            title={`Phát câu này (${formatTime(segment.start_ms)} - ${formatTime(segment.end_ms)})`}
                          >
                            ▷ Phát
                          </button>
                        </div>
                      </div>

                      <div className="dual-cell-actions">
                        <button
                          type="button"
                          className={`dual-more-btn ${rightRowMenuOpenId === segment.logical_segment_id ? "active" : ""}`}
                          title="Tùy chọn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRightRowMenuOpenId(
                              rightRowMenuOpenId === segment.logical_segment_id ? null : segment.logical_segment_id
                            );
                          }}
                        >
                          <Icon name="more" />
                        </button>

                        {rightRowMenuOpenId === segment.logical_segment_id && (
                          <div className="dual-row-menu-dropdown">
                            {editable && nextSegment && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRowMenuOpenId(null);
                                  setRightRowMenuOpenId(null);
                                  setPendingMerge([segment, nextSegment]);
                                }}
                                title={`Gộp ngay với đoạn dưới: "${nextSegment.text.slice(0, 30)}..."`}
                              >
                                <span>🔗 Gộp với đoạn dưới</span>
                              </button>
                            )}
                            {editable && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRowMenuOpenId(null);
                                  setRightRowMenuOpenId(null);
                                  toggleMerge(segment);
                                }}
                              >
                                <span>{isMergeSelected ? "✕ Bỏ chọn gộp" : "☑ Chọn gộp nhiều đoạn"}</span>
                              </button>
                            )}
                            {transText && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRightRowMenuOpenId(null);
                                  void copyToClipboard(transText);
                                  setNotice("Đã sao chép bản dịch.");
                                }}
                              >
                                <Icon name="copy" />
                                <span>Sao chép bản dịch</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setRightRowMenuOpenId(null);
                                player.current?.seek(segment.start_ms);
                              }}
                            >
                              <Icon name="play" />
                              <span>Phát đoạn này</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Realtime Streaming Live Entries when not in reverse mode */}
            {!recordingActive && renderLiveEntries()}
            <div
              ref={transcriptBottomRef}
              style={{ height: 0, minHeight: 0, pointerEvents: "none", scrollMarginBottom: 120 }}
            />
            </div>
          )}
        </div>
      </div>
    </div>
    )}

      {/* Popups removed: Handled as full-screen dedicated views */}

      {/* Centered Modal: XUẤT NỘI DUNG (ẢNH 4) */}
      {exportModalOpen && (
        <ExportContentModal
          meetingId={meetingId}
          meetingTitle={meeting.data.title}
          mediaId={media.data?.[0]?.id}
          close={() => setExportModalOpen(false)}
        />
      )}

      {/* Centered Modal: CHIA SẺ (ẢNH 1) */}
            {/* Live Share Modal with QR and realtime link */}
      {liveShareModalOpen && meeting.data && (
        <LiveShareModal
          meetingId={meetingId}
          meetingTitle={meeting.data.title}
          isRecording={recordingActive}
          close={() => setLiveShareModalOpen(false)}
        />
      )}

      {shareSocialOpen && (
        <ShareSocialModal
          meetingTitle={meeting.data.title}
          close={() => setShareSocialOpen(false)}
        />
      )}

      {/* Dialogs */}
      {renameOpen && (
        <RenameMeetingDialog
          title={meeting.data.title}
          close={() => setRenameOpen(false)}
          confirm={async (title) => {
            const updated = await meetingsApi.update(meetingId, { title });
            meeting.setData(updated);
            bundle.setData((prev) => (prev ? { ...prev, meeting: updated } : prev));
            setRenameOpen(false);
            setNotice("Đã đổi tên bản ghi.");
            window.dispatchEvent(new CustomEvent("bocbang:refresh-meetings", { detail: updated }));
          }}
        />
      )}

      {pendingSplit && (
        <SplitDialog
          segment={pendingSplit}
          close={() => setPendingSplit(undefined)}
          confirm={(splitAt, first, second) => void handleSplit(pendingSplit, splitAt, first, second)}
        />
      )}

      {pendingMerge && (
        <ConfirmDialog
          title={`Gộp ${pendingMerge.length} đoạn?`}
          detail="Các đoạn đã chọn sẽ được nối theo đúng thứ tự thời gian thành một đoạn."
          confirmLabel="Gộp đoạn"
          close={() => setPendingMerge(undefined)}
          confirm={() => void handleMerge(pendingMerge)}
        />
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Xóa đoạn transcript?"
          detail="Đoạn đã xóa sẽ không còn trong phiên bản transcript hiện hành."
          confirmLabel="Xóa đoạn"
          close={() => setPendingDelete(undefined)}
          confirm={() => {
            const segment = pendingDelete;
            setPendingDelete(undefined);
            void mutate(
              () => meetingsApi.deleteSegment(segment.logical_segment_id),
              "Đã xóa đoạn và tạo phiên bản mới.",
              segment.logical_segment_id
            );
          }}
        />
      )}

      {/* DOCKED BOTTOM BAR: RECORDING (KHI ĐANG / CHUẨN BỊ GHI ÂM) HOẶC PLAYBACK (ẢNH 2 & 4) */}
      {(!playbackMode || !media.data?.[0]) && (
        isRealtimeRecording ? (
          <RecordingPanel
            meetingId={meetingId}
            sttMode={meeting.data.stt_mode ?? "cloud"}
            modeLocked={meeting.data.status !== "created"}
            onSttModeChange={async mode => {
              await meetingsApi.update(meetingId, { stt_mode: mode });
              await meeting.reload();
            }}
            targetLanguage={targetLang || (realtimeTranslationSupported ? realtimeTarget : "en")}
            translationVisible={showRealtimeTranslations}
            onTranslationVisibleChange={setShowRealtimeTranslations}
            onTranslation={handleTranslationReceived}
            onTranslationsSnapshot={handleMultipleTranslationsReceived}
            onPartialTranslation={(streamSegmentId, text, sourceText) =>
              setLiveTranscript((current) => {
                const existing = current[streamSegmentId];
                return existing && (!sourceText || existing.text === sourceText)
                  ? { ...current, [streamSegmentId]: { ...existing, translation: text, updated_at: Date.now() } }
                  : current;
              })
            }
            existingSegmentIds={transcript.data?.segments?.map((s) => s.logical_segment_id) ?? []}
            existingTranslationIds={Object.keys(realtimeTranslations)}
            onTranscript={(event) => {
              if (event.stream_segment_id && resolvedBrowserDrafts.current.has(event.stream_segment_id)) return;
              if (event.type === "transcript.final" && event.stream_segment_id) finalizedBrowserTurns.current.add(event.stream_segment_id);
              setLiveTranscript((current) => updateLiveTranscript(current, event));
            }}
            onResetTranscript={() =>
              setLiveTranscript((current) =>
                meeting.data?.stt_mode === "browser" ? finishLiveTranscript(current) : Object.fromEntries(Object.entries(current).filter(([, event]) => event.type === "transcript.final"))
              )
            }
            onRecognitionInterrupted={() => {
              if (meeting.data?.stt_mode === "browser") setLiveTranscript(finishLiveTranscript);
            }}
            onFinal={() => {
              void transcript.reload();
              void speakers.reload();
              void versions.reload();
            }}
            onComplete={() => {
              void meeting.reload();
              void transcript.reload();
              void refreshMedia();
            }}
            onRecordingStateChange={updateRecordingState}
            hasStartedBefore={transcript.data?.segments !== undefined && transcript.data.segments.length > 0}
            hasAudio={Boolean(media.data?.[0])}
            initialElapsedMs={initialRecordingDurationMs}
            targetLang={targetLang}
            onTargetLangChange={setTargetLang}
            languageMode={(meeting.data?.language_mode as "auto" | "vi" | "en") || "auto"}
            onLanguageModeChange={async (newLang) => {
              const newTarget = newLang === "en" ? "vi" : newLang === "vi" ? "en" : "vi";
              setTargetLang(newTarget);
              try {
                await meetingsApi.update(meetingId, { language_mode: newLang });
                void meeting.reload();
              } catch {
                // ignore
              }
            }}
            onAudioChunk={(chunk) => {
              liveAudioChunksRef.current.push(chunk);
            }}
            onPlayback={() => {
              if (media.data?.[0]) {
                setPlaybackMode(true);
                player.current?.play();
              } else {
                ensureLiveAudioReady((url) => {
                  if (url || media.data?.[0]) {
                    setPlaybackMode(true);
                    setTimeout(() => player.current?.play(), 100);
                  } else {
                    setNotice("Chưa có bản ghi âm để phát lại.");
                  }
                });
              }
            }}
            playbackMode={playbackMode}
            onShare={() => setLiveShareModalOpen(true)}
            onSummary={() => setActiveMainView((prev) => prev === "summary" ? "transcript" : "summary")}
            onExport={() => setExportModalOpen(true)}
            onSpeakers={() => setActiveMainView((prev) => prev === "speakers" ? "transcript" : "speakers")}
            onSections={() => setActiveMainView((prev) => prev === "sections" ? "transcript" : "sections")}
            onPolish={() => {
              polishState.refresh();
              setActiveMainView((prev) => prev === "polish" ? "transcript" : "polish");
            }}
            activeMainView={activeMainView}
            isPolishBusy={polishState.busy}
          />
        ) : isAnyModalActive ? null : (
        <div className="bocbang-floating-bar-wrap">
          <div className="bocbang-floating-bar">
            {/* 1. Timer Capsule Pill */}
            <div className="bocbang-timer-pill" title="Thời lượng cuộc họp">
              <span className="bocbang-timer-dot" />
              <div className="bocbang-timer-content">
                <span className="bocbang-timer-digits">
                  {formatDuration(
                    meeting.data?.duration_ms
                      ? Math.floor(meeting.data.duration_ms / 1000)
                      : Math.floor(initialRecordingDurationMs / 1000)
                  )}
                </span>
                <span className="bocbang-timer-status">
                  {meeting.data?.status === "failed" || (media.data?.[0]?.status === "failed" && meeting.data?.status !== "completed")
                    ? "Thất bại"
                    : meeting.data?.status === "processing"
                    ? "Đang xử lý…"
                    : "Hoàn thành"}
                </span>
              </div>
            </div>

            {/* 2. Audio Playback Button */}
            <button
              type="button"
              className="bocbang-circle-btn"
              onClick={() => {
                if (media.data?.[0]) {
                  setPlaybackMode(true);
                  player.current?.play();
                } else {
                  setNotice("Chưa có bản ghi âm để phát lại.");
                }
              }}
              title="Phát lại bản ghi"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
              <span className="bocbang-tooltip">Phát lại bản ghi</span>
            </button>


            {/* 4. Meeting Sections Grid Button */}
            <button
              type="button"
              className={`bocbang-circle-btn ${activeMainView === "sections" ? "is-active" : ""}`}
              onClick={() => setActiveMainView((prev) => prev === "sections" ? "transcript" : "sections")}
              title="Bố cục phiên họp"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="12" y1="3" x2="12" y2="21" />
              </svg>
              <span className="bocbang-tooltip">Bố cục phiên họp</span>
            </button>

            {/* 5. AI Polish Button */}
            <button
              type="button"
              className={`bocbang-circle-btn ${polishState.busy ? "is-loading" : ""} ${activeMainView === "polish" ? "is-active" : ""}`}
              onClick={() => {
                polishState.refresh();
                setActiveMainView((prev) => prev === "polish" ? "transcript" : "polish");
              }}
              title="Làm mịn AI"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
                <line x1="19" y1="5" x2="19" y2="9" />
                <line x1="17" y1="7" x2="21" y2="7" />
              </svg>
              <span className="bocbang-tooltip">Làm mịn AI</span>
            </button>

            {/* 6. AI Summary Button */}
            <button
              type="button"
              className={`bocbang-circle-btn ${activeMainView === "summary" ? "is-active" : ""}`}
              onClick={() => setActiveMainView((prev) => prev === "summary" ? "transcript" : "summary")}
              title="Tóm tắt AI"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span className="bocbang-tooltip">Tóm tắt AI</span>
            </button>

            {/* 7. Speakers Management Button */}
            <button
              type="button"
              className={`bocbang-circle-btn ${activeMainView === "speakers" ? "is-active" : ""}`}
              onClick={() => setActiveMainView((prev) => prev === "speakers" ? "transcript" : "speakers")}
              title="Quản lý người nói"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
              <span className="bocbang-tooltip">Quản lý người nói</span>
            </button>

            {/* Live Share Button */}
            <button
              type="button"
              className="bocbang-circle-btn"
              onClick={() => setLiveShareModalOpen(true)}
              title="Chia sẻ cuộc họp trực tiếp (Mã QR / Liên kết)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="18" cy="5" r="3" />
                <circle cx="6" cy="12" r="3" />
                <circle cx="18" cy="19" r="3" />
                <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
                <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
              </svg>
              <span className="bocbang-tooltip">Chia sẻ trực tiếp</span>
            </button>

            {/* 8. Download / Export Button */}
            <button
              type="button"
              className="bocbang-circle-btn"
              onClick={() => setExportModalOpen(true)}
              title="Xuất nội dung (PDF, Word, Audio)"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              <span className="bocbang-tooltip">Xuất nội dung</span>
            </button>
          </div>
        </div>
        )
      )}



      {logAiOpen && (
        <LogAiModal
          meetingTitle={meeting.data.title}
          close={() => setLogAiOpen(false)}
        />
      )}

      {voiceLearningSegment && (
        <VoiceLearningDialog
          meetingId={meetingId}
          ownerId={meeting.data?.owner_id}
          segment={voiceLearningSegment}
          segments={transcript.data?.segments ?? []}
          speaker={speakers.data?.find((s) => s.id === voiceLearningSegment.speaker_id)}
          canLearn={editable}
          close={() => setVoiceLearningSegment(null)}
          onQueued={() => {
            setNotice("Đang xử lý phân tích và lưu mẫu giọng trong nền…");
            setVoiceLearningSegment(null);
          }}
          onLabeled={() => {
            void transcript.reload();
            void speakers.reload();
            setVoiceLearningSegment(null);
            setNotice("Đã cập nhật giọng nói người tham gia.");
          }}
        />
      )}

      {/* Polish and sections popups removed: Handled as full-screen dedicated views */}
    </div>
  );
}

/* ═══════════════════════════════════════════
   SLIDE-OVER DRAWER: TÓM TẮT AI
═══════════════════════════════════════════ */
const summaryLabels: Record<SummaryTemplate, string> = {
  general: "Tóm tắt chung",
  briefing: "Họp giao ban",
  voting: "Họp biểu quyết",
};
const summaryLangLabels: Record<SummaryLanguage, string> = { vi: "Tiếng Việt", en: "English" };


function humanizeKey(key: string) {
  return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function toSummaryText(content: Record<string, unknown>): string {
  return Object.entries(content)
    .map(([key, value]) => {
      const heading = humanizeKey(key);
      const text = typeof value === "object" && value !== null ? JSON.stringify(value, null, 2) : String(value);
      return `${heading}:\n${text}`;
    })
    .join("\n\n");
}

function SummaryValueRenderer({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span style={{ color: "var(--muted, #94a3b8)", fontSize: 13, fontStyle: "italic" }}>— Không có thông tin</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <span style={{ color: "var(--muted, #94a3b8)", fontSize: 13, fontStyle: "italic", display: "inline-block", margin: "4px 0" }}>
          — Không có nội dung ghi nhận cho mục này
        </span>
      );
    }
    return (
      <ul style={{ margin: "4px 0", paddingLeft: 20 }}>
        {value.map((item, index) => (
          <li key={index} style={{ marginBottom: 4 }}>
            <SummaryValueRenderer value={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    return (
      <div style={{ paddingLeft: 12, borderLeft: "2px solid rgba(255,255,255,0.1)" }}>
        {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
          <div key={k} style={{ marginBottom: 6 }}>
            <strong style={{ color: "#94a3b8", fontSize: 12.5 }}>{humanizeKey(k)}: </strong>
            <SummaryValueRenderer value={v} />
          </div>
        ))}
      </div>
    );
  }
  const textVal = String(value).trim();
  if (!textVal) return <span style={{ color: "var(--muted, #94a3b8)", fontSize: 13, fontStyle: "italic" }}>— Không có nội dung</span>;
  return <span>{textVal}</span>;
}

function SummaryAiModal({
  meetingId,
  meetingTitle,
  hasTranscript,
  editable,
  summaries,
  capabilities,
  close,
  isFullScreen,
}: {
  isFullScreen?: boolean;
  meetingId: string;
  meetingTitle: string;
  hasTranscript: boolean;
  editable: boolean;
  summaries: any;
  capabilities: any;
  close: () => void;
}) {
  const jobs = useJobMonitor();
  const sections = useAsync(() => meetingsApi.sections(meetingId), [meetingId]);
  const [mode, setMode] = useState<SummaryMode>("template");
  const [scope, setScope] = useState<SummaryScope>("meeting");
  const [template, setTemplate] = useState<SummaryTemplate>("general");
  const [customPrompt, setCustomPrompt] = useState("");
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [outputLang, setOutputLang] = useState<SummaryLanguage>("vi");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [savingEdit, setSavingEdit] = useState(false);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 3500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    void summaries.reload();
  }, []);

  useEffect(() => {
    if (jobs.job?.status === "completed") {
      void summaries.reload();
    }
  }, [jobs.job?.status]);

  useEffect(() => {
    if (sections.data && selectedSectionIds.length === 0) {
      setSelectedSectionIds(sections.data.map((s) => s.id));
    }
  }, [sections.data]);

  const summary = summaries.data?.find((item: any) => {
    const itemMode = item.mode ?? "template";
    const itemScope = item.scope ?? "meeting";
    if (itemMode !== mode) return false;
    if (item.output_language !== outputLang) return false;
    if (itemScope !== scope) return false;
    if (mode === "template" && item.template !== template) return false;
    return true;
  }) ?? summaries.data?.[0];

  useEffect(() => {
    if (summary?.current_version?.content) {
      const initialFields: Record<string, string> = {};
      for (const [k, v] of Object.entries(summary.current_version.content)) {
        if (Array.isArray(v)) {
          initialFields[k] = v.join("\n");
        } else if (typeof v === "object" && v !== null) {
          initialFields[k] = JSON.stringify(v, null, 2);
        } else {
          initialFields[k] = String(v ?? "");
        }
      }
      setEditFields(initialFields);
    }
  }, [summary?.id, summary?.current_version?.version_no]);

  async function generate() {
    try {
      setError("");
      setNotice("");
      setEditing(false);
      const payload: any = {
        mode,
        scope,
        output_language: outputLang,
      };
      if (mode === "template") {
        payload.template = template;
      } else {
        if (!customPrompt.trim()) {
          setError("Vui lòng nhập câu lệnh tóm tắt tùy chỉnh.");
          return;
        }
        payload.prompt = customPrompt.trim();
      }
      if (scope === "sessions") {
        if (selectedSectionIds.length === 0) {
          setError("Vui lòng chọn ít nhất một phiên họp.");
          return;
        }
        payload.section_ids = selectedSectionIds;
        payload.sections_revision = sections.data?.[0]?.revision;
      }
      const job = await meetingsApi.summary(meetingId, payload);
      jobs.track(job);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  async function saveEditedSummary() {
    if (!summary) return;
    try {
      setSavingEdit(true);
      setError("");
      const newContent: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(editFields)) {
        const orig = summary.current_version.content[k];
        if (Array.isArray(orig)) {
          newContent[k] = v.split("\n").map((s) => s.trim()).filter(Boolean);
        } else if (typeof orig === "object" && orig !== null) {
          try {
            newContent[k] = JSON.parse(v);
          } catch {
            newContent[k] = v;
          }
        } else {
          newContent[k] = v;
        }
      }
      await meetingsApi.editSummary(summary.id, newContent, summary.current_version.version_no);
      await summaries.reload();
      setEditing(false);
      setNotice("Đã lưu phiên bản tóm tắt mới thành công.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingEdit(false);
    }
  }

  async function copy() {
    if (!summary?.current_version?.content) return;
    try {
      await copyToClipboard(toSummaryText(summary.current_version.content));
      setNotice("Đã sao chép tóm tắt vào bộ nhớ tạm.");
    } catch {
      setError("Không thể sao chép nội dung.");
    }
  }

  const jobActive = ["queued", "processing", "retrying"].includes(jobs.job?.status ?? "");

  const summaryBody = (
    <div className={isFullScreen ? "dedicated-feature-body" : "summary-modal-body"}>
      {/* Sticky Controls Panel: Mode Switch, Language Selection, Templates, and Scope */}
      <div
        className="summary-sticky-controls"
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "var(--surface, #ffffff)",
          paddingBottom: 14,
          borderBottom: "1px solid var(--border)",
          marginBottom: 14,
        }}
      >
        {/* Row 1: Mode Switch & Language Selection */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, paddingBottom: 12, borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <button
              type="button"
              className={`summary-pill-btn ${mode === "template" ? "is-active" : ""}`}
              onClick={() => setMode("template")}
            >
              Mẫu có sẵn
            </button>
            <button
              type="button"
              className={`summary-pill-btn ${mode === "custom" ? "is-active" : ""}`}
              onClick={() => setMode("custom")}
            >
              ⚡ Tùy chỉnh (Prompt)
            </button>
          </div>

          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--muted)", marginRight: 4, fontWeight: 600 }}>Ngôn ngữ:</span>
            <button
              type="button"
              className={`summary-pill-btn ${outputLang === "vi" ? "is-active" : ""}`}
              onClick={() => setOutputLang("vi")}
              style={{ padding: "4px 12px", fontSize: 12.5, fontWeight: outputLang === "vi" ? 700 : 500 }}
            >
              Tiếng Việt
            </button>
            <button
              type="button"
              className={`summary-pill-btn ${outputLang === "en" ? "is-active" : ""}`}
              onClick={() => setOutputLang("en")}
              style={{ padding: "4px 12px", fontSize: 12.5, fontWeight: outputLang === "en" ? 700 : 500 }}
            >
              English
            </button>
          </div>
        </div>

        {/* Row 2: Template Pills or Custom Prompt Input */}
        {mode === "template" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <span style={{ fontSize: 13, color: "var(--muted)" }}>Chọn mẫu:</span>
            <div className="summary-template-pills">
              {Object.entries(summaryLabels).map(([k, v]) => (
                <button
                  type="button"
                  key={k}
                  className={`summary-pill-btn ${template === k ? "is-active" : ""}`}
                  onClick={() => setTemplate(k as SummaryTemplate)}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <label style={{ fontSize: 13, color: "var(--secondary, #cbd5e1)", display: "block", marginBottom: 6, fontWeight: 600 }}>
              Câu lệnh tùy chỉnh cho AI:
            </label>
            <textarea
              className="summary-custom-textarea"
              rows={3}
              placeholder="Ví dụ: Tóm tắt các quyết định quan trọng, công việc được giao cho ai và hạn chót hoàn thành..."
              value={customPrompt}
              onChange={(e) => setCustomPrompt(e.target.value)}
              maxLength={4000}
            />
          </div>
        )}

        {/* Row 3: Scope Selector (Toàn bộ cuộc họp vs Theo phiên họp) */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, color: "var(--muted)", marginRight: 4 }}>Phạm vi:</span>
          <button
            type="button"
            className={`summary-pill-btn ${scope === "meeting" ? "is-active" : ""}`}
            onClick={() => setScope("meeting")}
          >
            Toàn bộ cuộc họp
          </button>
          <button
            type="button"
            className={`summary-pill-btn ${scope === "sessions" ? "is-active" : ""}`}
            onClick={() => setScope("sessions")}
          >
            Theo phiên họp ({sections.data?.length ?? 0} phiên)
          </button>
        </div>

        {/* Sessions Checklist when scope === 'sessions' */}
        {scope === "sessions" && (
          <div className="summary-session-selection">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>Chọn các phiên cần tóm tắt:</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  style={{ background: "transparent", border: 0, color: "#38bdf8", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
                  onClick={() => setSelectedSectionIds(sections.data?.map((s) => s.id) ?? [])}
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  style={{ background: "transparent", border: 0, color: "#94a3b8", cursor: "pointer", fontSize: 12, fontWeight: 500 }}
                  onClick={() => setSelectedSectionIds([])}
                >
                  Bỏ chọn
                </button>
              </div>
            </div>
            <div style={{ maxHeight: 150, overflowY: "auto" }}>
              {(sections.data ?? []).map((sec) => (
                <label key={sec.id} className="summary-session-option">
                  <input
                    type="checkbox"
                    checked={selectedSectionIds.includes(sec.id)}
                    onChange={(e) => {
                      if (e.target.checked) setSelectedSectionIds((prev) => [...prev, sec.id]);
                      else setSelectedSectionIds((prev) => prev.filter((id) => id !== sec.id));
                    }}
                  />
                  <span>
                    <strong>{sec.title}</strong>
                    <small>{formatTime(sec.start_ms)} – {sec.end_ms ? formatTime(sec.end_ms) : "Hiện tại"}</small>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Action Row */}
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
          {editable && (
            <button
              type="button"
              className="export-btn-primary"
              disabled={!hasTranscript || jobActive}
              onClick={() => void generate()}
              style={{ flex: 1, height: 40 }}
            >
              {jobActive ? "Đang tạo tóm tắt…" : summary ? "Tạo lại tóm tắt" : "Tạo tóm tắt AI"}
            </button>
          )}
          {summary && (
            <>
              <button
                type="button"
                className="export-btn-secondary"
                onClick={() => setEditing((prev) => !prev)}
                style={{ width: "auto", padding: "0 16px", height: 40, gap: 6 }}
              >
                <Icon name="edit" /> {editing ? "Hủy sửa" : "Sửa tóm tắt"}
              </button>
              <button
                type="button"
                className="export-btn-secondary"
                onClick={() => void copy()}
                style={{ width: "auto", padding: "0 18px", height: 40, gap: 6 }}
              >
                <Icon name="copy" /> Sao chép
              </button>
              <button
                type="button"
                className="export-btn-secondary"
                onClick={() => {
                  if (!summary?.current_version?.content) return;
                  const txt = toSummaryText(summary.current_version.content);
                  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${meetingTitle}_tom_tat.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                style={{ width: "auto", padding: "0 16px", height: 40, gap: 6 }}
                title="Tải về tệp .txt"
              >
                <Icon name="download" /> Xuất TXT
              </button>
            </>
          )}
        </div>
      </div>

          {error && <div className="form-error" style={{ marginTop: 10 }}>{error}</div>}
          {notice && (
            <div className="bocbang-floating-toast" role="status" aria-live="polite">
              <span className="toast-icon">✓</span>
              <span className="toast-message">{notice}</span>
              <button
                type="button"
                className="toast-close-btn"
                onClick={() => setNotice("")}
                aria-label="Đóng"
              >
                ×
              </button>
            </div>
          )}
          {jobs.job && (
            <div className={`job-state ${jobs.job.status}`} style={{ marginTop: 10 }}>
              Tóm tắt AI: {statusLabel(jobs.job.status)}
              {jobs.job.progress !== undefined ? ` · ${jobs.job.progress}%` : ""}
            </div>
          )}

          {/* Content / Editor */}
          {editing ? (
            <div className="summary-editor">
              <h2>Chỉnh sửa nội dung tóm tắt</h2>
              {Object.entries(editFields).map(([key, val]) => (
                <div className="field" key={key}>
                  <label style={{ fontSize: 13, fontWeight: 700, color: "var(--secondary)" }}>{humanizeKey(key)}</label>
                  <textarea
                    rows={4}
                    value={val}
                    onChange={(e) => setEditFields((cur) => ({ ...cur, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <div className="summary-editor-actions">
                <Button onClick={() => setEditing(false)}>Hủy</Button>
                <Button tone="dark" disabled={savingEdit} onClick={() => void saveEditedSummary()}>
                  {savingEdit ? "Đang lưu..." : "Lưu phiên bản mới"}
                </Button>
              </div>
            </div>
          ) : summaries.loading ? (
            <Loading label="Đang tải bản tóm tắt…" />
          ) : summary?.current_version?.content ? (
            <div className="summary-content-box" style={{ marginTop: 16 }}>
              <div style={{ marginBottom: 14, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Status>{summary.mode === "custom" ? "Tùy chỉnh (Prompt)" : summaryLabels[summary.template as SummaryTemplate]}</Status>
                <span style={{ fontSize: 12, color: "var(--muted)" }}>
                  Phiên bản {summary.current_version.version_no} · {new Date(summary.current_version.created_at).toLocaleString("vi-VN")}
                </span>
                {summary.scope === "sessions" && (
                  <span style={{ fontSize: 11, background: "rgba(56,189,248,0.15)", color: "#38bdf8", padding: "2px 8px", borderRadius: 4 }}>
                    Theo phiên họp
                  </span>
                )}
              </div>

              {Object.entries(summary.current_version.content).map(([key, value]) => (
                <div key={key} style={{ marginBottom: 16 }}>
                  <h4 className="summary-section-heading">
                    {humanizeKey(key)}
                  </h4>
                  <SummaryValueRenderer value={value} />
                </div>
              ))}
            </div>
          ) : (
            <div className="empty-state" style={{ padding: 48, textAlign: "center", color: "var(--muted)" }}>
              <p style={{ fontSize: 15, marginBottom: 8, fontWeight: 500 }}>Chưa có bản tóm tắt nào cho lựa chọn này.</p>
              <p style={{ fontSize: 13 }}>Bấm <strong>&quot;Tạo tóm tắt AI&quot;</strong> ở trên để bắt đầu tạo nội dung tóm tắt.</p>
            </div>
          )}
    </div>
  );

  if (isFullScreen) {
    return (
      <div className="dedicated-feature-view summary-dedicated-view">
        {summaryBody}
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="summary-modal-card" style={{ maxWidth: 840 }} onClick={(e) => e.stopPropagation()}>
        <div className="summary-modal-header">
          <div className="summary-modal-title-group">
            <div className="summary-modal-icon-badge">
              <Icon name="sparkles" />
            </div>
            <div>
              <h3 className="summary-modal-title">Tóm tắt AI Cuộc họp</h3>
              <p className="summary-modal-subtitle">{meetingTitle}</p>
            </div>
          </div>
          <button type="button" className="summary-modal-close" onClick={close} aria-label="Đóng">
            ✕
          </button>
        </div>
        {summaryBody}
      </div>
    </div>
  );
}


const MediaPlayer = forwardRef<
  AudioPlayerHandle,
  {
    meetingId: string;
    mediaId?: string;
    liveBlobUrl?: string;
    filename: string;
    segments: Segment[];
    playbackMode: boolean;
    onClosePlayback?: () => void;
    onActiveSegment: (id?: string) => void;
    onSummary?: () => void;
    onSpeakers?: () => void;
    onShare?: () => void;
    onExport?: () => void;
    downloadUrl?: string;
  }
>(function MediaPlayer(
  {
    meetingId,
    mediaId,
    liveBlobUrl,
    filename,
    segments,
    playbackMode,
    onClosePlayback,
    onActiveSegment,
    onSummary,
    onSpeakers,
    onShare,
    onExport,
    downloadUrl,
  },
  ref
) {
  const audio = useRef<HTMLAudioElement>(null);
  const [source, setSource] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [shuffle, setShuffle] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const stopAtMsRef = useRef<number | null>(null);

  const speeds = [0.75, 1, 1.25, 1.5, 2];
  function cyclePlaybackSpeed() {
    const nextIdx = (speeds.indexOf(playbackSpeed) + 1) % speeds.length;
    const nextSpeed = speeds[nextIdx];
    setPlaybackSpeed(nextSpeed);
    if (audio.current) audio.current.playbackRate = nextSpeed;
  }

  useImperativeHandle(
    ref,
    () => ({
      playSegment(startMs: number, endMs: number) {
        stopAtMsRef.current = endMs;
        const element = audio.current;
        if (!element) return;
        element.currentTime = startMs / 1000;
        void element.play();
        setIsPlaying(true);
      },
      seek(milliseconds) {
        stopAtMsRef.current = null;
        const element = audio.current;
        if (!element) return;
        element.currentTime = milliseconds / 1000;
        void element.play();
        setIsPlaying(true);
      },
      play() {
        stopAtMsRef.current = null;
        void audio.current?.play();
        setIsPlaying(true);
      },
      pause() {
        stopAtMsRef.current = null;
        audio.current?.pause();
        setIsPlaying(false);
      },
      toggle() {
        stopAtMsRef.current = null;
        if (!audio.current) return;
        if (audio.current.paused) {
          void audio.current.play();
          setIsPlaying(true);
        } else {
          audio.current.pause();
          setIsPlaying(false);
        }
      },
      toggleMute() {
        if (!audio.current) return false;
        audio.current.muted = !audio.current.muted;
        setIsMuted(audio.current.muted);
        return audio.current.muted;
      },
    }),
    []
  );

  useEffect(() => {
    if (liveBlobUrl) {
      setSource(liveBlobUrl);
      return;
    }
    let active = true;
    let objectUrl = "";
    setSource("");
    if (!mediaId || mediaId === "live") return;
    // Prefer HTTP 206 Range-supported playback URL for fast non-blocking seeking
    meetingsApi
      .playbackUrl(meetingId, mediaId)
      .then((res) => {
        if (active && res.url) {
          setSource(res.url);
          return;
        }
        return meetingsApi.streamMedia(meetingId, mediaId).then((blob) => {
          if (!blob.size) return;
          objectUrl = URL.createObjectURL(blob);
          if (active) setSource(objectUrl);
          else URL.revokeObjectURL(objectUrl);
        });
      })
      .catch(() => {
        meetingsApi.streamMedia(meetingId, mediaId).then((blob) => {
          if (!blob.size) return;
          objectUrl = URL.createObjectURL(blob);
          if (active) setSource(objectUrl);
          else URL.revokeObjectURL(objectUrl);
        }).catch(() => {});
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [meetingId, mediaId, liveBlobUrl]);

  function syncTranscript() {
    const sec = audio.current?.currentTime ?? 0;
    setCurrentTime(sec);
    const milliseconds = sec * 1000;

    // When replaying a specific sentence, stop automatically at sentence end
    if (stopAtMsRef.current !== null && milliseconds >= stopAtMsRef.current) {
      audio.current?.pause();
      setIsPlaying(false);
      stopAtMsRef.current = null;
      onActiveSegment(undefined);
      return;
    }

    const segment = segments.find((item) => item.start_ms <= milliseconds && milliseconds < item.end_ms);
    onActiveSegment(segment?.logical_segment_id);
  }

  function handleSkip(deltaSec: number) {
    stopAtMsRef.current = null;
    if (!audio.current) return;
    const next = Math.max(0, Math.min(duration, (audio.current.currentTime || 0) + deltaSec));
    audio.current.currentTime = next;
    setCurrentTime(next);
  }

  function formatAudioTime(seconds: number) {
    if (!seconds || isNaN(seconds)) return "--:--";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return (
    <>
      <audio
        ref={audio}
        preload="metadata"
        src={source || undefined}
        onTimeUpdate={syncTranscript}
        onLoadedMetadata={() => setDuration(audio.current?.duration ?? 0)}
        onDurationChange={() => setDuration(audio.current?.duration ?? 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          onActiveSegment(undefined);
        }}
        style={{ display: "none" }}
      />

      {/* FULL BOTTOM AUDIO PLAYER BAR (ẢNH 3 - REDESIGNED) */}
      {playbackMode && (
        <div className="full-bottom-audio-bar">
          <div className="bottom-player-track-line">
            <span className="player-track-time">{formatAudioTime(currentTime)}</span>
            <div className="player-slider-container">
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={(e) => {
                  stopAtMsRef.current = null;
                  const val = Number(e.target.value);
                  if (audio.current) audio.current.currentTime = val;
                  setCurrentTime(val);
                }}
                className="bottom-player-slider"
              />
              <div
                className="player-slider-fill"
                style={{ width: `${duration ? (currentTime / duration) * 100 : 0}%` }}
              />
            </div>
            <span className="player-track-time">{formatAudioTime(duration)}</span>
          </div>

          <div className="bottom-player-controls-row">
            {/* Left Column: Info & Speed */}
            <div className="player-left-col">
              <div className="player-audio-badge">
                <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                  <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                </svg>
              </div>
              <div className="player-info-text">
                <span className="player-label-now">Đang phát lại</span>
                <span className="player-filename" title={filename || "Bản ghi âm"}>
                  {filename || "Bản ghi âm cuộc họp"}
                </span>
              </div>
              <button
                type="button"
                className="player-speed-badge"
                onClick={cyclePlaybackSpeed}
                title="Thay đổi tốc độ phát"
              >
                {playbackSpeed}x
              </button>
            </div>

            {/* Center: Main Controls */}
            <div className="player-main-ctrls">
              <button
                type="button"
                className={`player-mini-btn ${shuffle ? "is-active" : ""}`}
                onClick={() => setShuffle(!shuffle)}
                title="Phát ngẫu nhiên"
              >
                🔀
              </button>
              <button
                type="button"
                className="player-arrow-btn"
                onClick={() => handleSkip(-10)}
                title="Lùi 10 giây"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 19l-9-7 9-7v14zM22 19l-9-7 9-7v14z" />
                </svg>
              </button>
              <button
                type="button"
                className="player-circle-play-btn"
                onClick={() => {
                  if (!audio.current) return;
                  if (isPlaying) audio.current.pause();
                  else void audio.current.play();
                }}
                title={isPlaying ? "Tạm dừng" : "Phát"}
              >
                {isPlaying ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <rect x="6" y="4" width="4" height="16" rx="1" />
                    <rect x="14" y="4" width="4" height="16" rx="1" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
                    <polygon points="6 3 20 12 6 21 6 3" />
                  </svg>
                )}
              </button>
              <button
                type="button"
                className="player-arrow-btn"
                onClick={() => handleSkip(10)}
                title="Tới 10 giây"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 19l9-7-9-7v14zM2 19l9-7-9-7v14z" />
                </svg>
              </button>
            </div>

            {/* Right Column: Volume, Actions & Close */}
            <div className="player-right-col">
              <div className="player-vol-wrap">
                <button
                  type="button"
                  className="player-mini-btn"
                  onClick={() => {
                    if (!audio.current) return;
                    audio.current.muted = !audio.current.muted;
                    setIsMuted(audio.current.muted);
                  }}
                  title={isMuted ? "Bật âm thanh" : "Tắt tiếng"}
                >
                  {isMuted ? "🔇" : "🔊"}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={isMuted ? 0 : volume}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setVolume(val);
                    if (audio.current) {
                      audio.current.volume = val;
                      audio.current.muted = val === 0;
                      setIsMuted(val === 0);
                    }
                  }}
                  className="player-vol-slider"
                />
              </div>

              {/* Action Cluster in Playback Bar */}
              <div className="playback-actions-cluster">
                {onSummary && (
                  <button
                    type="button"
                    className="player-action-icon-btn"
                    onClick={onSummary}
                    title="Tóm tắt AI cuộc họp"
                  >
                    <Icon name="sparkles" />
                  </button>
                )}
                {onSpeakers && (
                  <button
                    type="button"
                    className="player-action-icon-btn"
                    onClick={onSpeakers}
                    title="Quản lý người nói"
                  >
                    <Icon name="speaker" />
                  </button>
                )}
                {onShare && (
                  <button
                    type="button"
                    className="player-action-icon-btn"
                    onClick={onShare}
                    title="Chia sẻ cuộc họp"
                  >
                    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8m-4-6-4-4-4 4m4-4v13" />
                    </svg>
                  </button>
                )}
                {onExport && (
                  <button
                    type="button"
                    className="player-action-icon-btn"
                    onClick={onExport}
                    title="Xuất nội dung"
                  >
                    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                      <polyline points="10 9 9 9 8 9" />
                    </svg>
                  </button>
                )}
                {downloadUrl && (
                  <a
                    className="player-action-icon-btn"
                    onClick={async (e) => {
                      e.preventDefault();
                      try {
                        const blob = await recordingApi.download(meetingId, mediaId || "");
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = filename || "cuoc_hop.m4a";
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      } catch (err) {
                        alert("Không thể tải tệp âm thanh: " + (err as Error).message);
                      }
                    }}
                    href="#"
                    download={filename}
                    title="Tải tệp âm thanh"
                  >
                    <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4m4-5 5 5 5-5m-5 5V3" />
                    </svg>
                  </a>
                )}
              </div>

              {onClosePlayback && (
                <button
                  type="button"
                  className="player-close-pill-btn"
                  onClick={() => {
                    audio.current?.pause();
                    setIsPlaying(false);
                    onActiveSegment(undefined);
                    onClosePlayback();
                  }}
                  title="Đóng thanh nghe lại, quay về thanh công cụ"
                >
                  <Icon name="close" />
                  <span>Đóng</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
});

function RecordingPanel({
  meetingId,
  targetLanguage,
  translationVisible,
  onTranslationVisibleChange,
  onTranslation,
  onTranslationsSnapshot,
  onPartialTranslation,
  existingSegmentIds,
  existingTranslationIds,
  onTranscript,
  onResetTranscript,
  onRecognitionInterrupted,
  onFinal,
  onComplete,
  onRecordingStateChange,
  hasStartedBefore,
  hasAudio,
  initialElapsedMs,
  targetLang,
  onTargetLangChange,
  onPlayback,
  playbackMode,
  onShare,
  onSummary,
  onExport,
  onSpeakers,
  onSections,
  onPolish,
  isPolishBusy,
  languageMode = "auto",
  sttMode = "cloud",
  modeLocked = false,
  onSttModeChange,
  onLanguageModeChange,
  activeMainView,
  onAudioChunk,
}: {
  meetingId: string;
  targetLanguage?: string;
  translationVisible: boolean;
  onTranslationVisibleChange: (visible: boolean) => void;
  onTranslation: (logicalSegmentId: string, translation: RealtimeTranslation) => void;
  onTranslationsSnapshot?: (batch: Record<string, RealtimeTranslation>) => void;
  onPartialTranslation?: (streamSegmentId: string, text: string, sourceText?: string) => void;
  existingSegmentIds?: string[];
  existingTranslationIds?: string[];
  onTranscript: (event: TranscriptEvent) => void;
  onResetTranscript: () => void;
  onRecognitionInterrupted: () => void;
  onFinal: () => void;
  onComplete: () => void;
  onRecordingStateChange: (active: boolean) => void;
  hasStartedBefore?: boolean;
  hasAudio?: boolean;
  initialElapsedMs: number;
  targetLang: string;
  onTargetLangChange: (lang: string) => void;
  onPlayback?: () => void;
  playbackMode?: boolean;
  onShare: () => void;
  onSummary: () => void;
  onExport?: () => void;
  onSpeakers: () => void;
  onSections?: () => void;
  onPolish?: () => void;
  isPolishBusy?: boolean;
  languageMode?: "auto" | "vi" | "en";
  sttMode?: SttMode;
  modeLocked?: boolean;
  onSttModeChange?: (mode: SttMode) => Promise<void>;
  onLanguageModeChange?: (lang: "auto" | "vi" | "en") => void;
  activeMainView?: "transcript" | "sections" | "polish" | "summary" | "speakers";
  onAudioChunk?: (chunk: ArrayBuffer) => void;
}) {
  const { accessToken, getValidAccessToken } = useAuth();
  const socket = useRef<MeetingSocket | undefined>(undefined);
  const capture = useRef<MicrophonePcmCapture | undefined>(undefined);
  const browserSpeech = useRef<BrowserSpeech | undefined>(undefined);
  const sessionAudioBytes = useRef(0);
  const startedAt = useRef<number | undefined>(undefined);
  const maxElapsedRef = useRef(Math.floor(initialElapsedMs / 1000));
  const elapsedBeforePause = useRef(Math.floor(initialElapsedMs / 1000));
  const hasEverStarted = useRef(false);
  const translationEnabled = useRef(true);
  const finalSegmentIds = useRef(new Set<string>());
  const finalTurnIds = useRef(new Set<string>());
  const translatedSegmentIds = useRef(new Set<string>());
  const [status, setStatus] = useState("Sẵn sàng ghi âm");
  const [translationStatus, setTranslationStatus] = useState("");
  const [fallbackWarning, setFallbackWarning] = useState("");
  const [state, setState] = useState<"idle" | "connecting" | "recording" | "paused" | "stopping" | "stopped" | "failed">(
    "idle"
  );
  const [elapsed, setElapsed] = useState(Math.floor(initialElapsedMs / 1000));
  const [confirmAction, setConfirmAction] = useState<null | "pause" | "stop">(null);
  const [savingSttMode, setSavingSttMode] = useState(false);

  useEffect(() => {
    const newIds = (existingSegmentIds ?? []).filter(id => !finalSegmentIds.current.has(id));
    if (existingSegmentIds && existingSegmentIds.length > 0) {
      for (const id of existingSegmentIds) {
        finalSegmentIds.current.add(id);
      }
    }
    if (existingTranslationIds && existingTranslationIds.length > 0) {
      for (const id of existingTranslationIds) {
        translatedSegmentIds.current.add(id);
      }
    }
    // HTTP recovery creates a persisted turn without a native final event.
    // Backfill that turn through the same live translator as normal finals.
    if (newIds.length && state === "recording" && translationEnabled.current && targetLanguage) {
      socket.current?.enableTranslation(targetLanguage, newIds);
    }
  }, [existingSegmentIds, existingTranslationIds, state, targetLanguage]);

  useEffect(() => () => {
    void stop(true);
  }, []);

  useEffect(() => {
    const handleStartEvent = () => {
      if (state === "idle" || state === "failed") {
        void start();
      }
    };
    window.addEventListener("bocbang:start-recording", handleStartEvent);
    return () => window.removeEventListener("bocbang:start-recording", handleStartEvent);
  }, [state]);

  useEffect(() => {
    if (state === "recording" && targetLanguage && socket.current) {
      socket.current.enableTranslation(targetLanguage, missingTranslationIds());
    }
  }, [targetLanguage, state]);
  useEffect(
    () => onRecordingStateChange(state !== "idle" && state !== "stopped" && state !== "failed"),
    [state, onRecordingStateChange]
  );
  useEffect(() => {
    if (state !== "idle") return;
    const initialSeconds = Math.floor(initialElapsedMs / 1000);
    maxElapsedRef.current = Math.max(maxElapsedRef.current, initialSeconds);
    elapsedBeforePause.current = maxElapsedRef.current;
    setElapsed(maxElapsedRef.current);
  }, [initialElapsedMs, state]);
  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      const currentStart = startedAt.current ?? now;
      const additional = Math.max(0, Math.floor((now - currentStart) / 1000));
      const total = elapsedBeforePause.current + additional;
      maxElapsedRef.current = Math.max(maxElapsedRef.current, total);
      setElapsed(maxElapsedRef.current);
    }, 1000);
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
      const currentElapsed = Math.max(
        elapsed,
        maxElapsedRef.current,
        elapsedBeforePause.current,
        Math.floor(initialElapsedMs / 1000)
      );
      maxElapsedRef.current = currentElapsed;
      elapsedBeforePause.current = currentElapsed;
      setElapsed(currentElapsed);
      startedAt.current = Date.now();
      if (!hasEverStarted.current) {
        hasEverStarted.current = true;
        onResetTranscript();
      }
      sessionAudioBytes.current = 0;
      browserSpeech.current?.cancel();
      if (sttMode === "browser") {
        browserSpeech.current = new BrowserSpeech(event.language,
          () => Math.floor(sessionAudioBytes.current / 32),
          result => {
            // Paint native recognition immediately; backend echoes acknowledge
            // durability and finals. Never claim a local preview has been saved.
            if ((!result.save_draft || result.recognition_status) && event.stream_session_id) {
              onTranscript({ type: "transcript.partial", language: event.language,
                start_ms: result.start_ms + (event.time_offset_ms ?? 0),
                end_ms: result.end_ms + (event.time_offset_ms ?? 0), text: result.text,
                stream_start_ms: result.start_ms, stream_end_ms: result.end_ms,
                stream_segment_id: `${event.stream_session_id}:${result.result_id}`,
                revision: result.revision, awaiting_final: result.final,
                recognition_status: result.final ? "unconfirmed" : result.recognition_status });
            }
            socket.current?.sendBrowserTranscript(result);
          },
          message => {
            setStatus(message); setState("failed");
            socket.current?.close();
            void releaseCapture(false);
          });
      }
      void capture.current?.resume().then(() => browserSpeech.current?.start()).catch(cause => {
        browserSpeech.current?.cancel(); socket.current?.close();
        setState("failed"); setStatus((cause as Error).message); void releaseCapture(false);
      });
      setState("recording");
      setStatus(sttMode === "browser" ? "Web Speech đang nhận diện; dịch và AI vẫn dùng Cloud." : "Đang ghi âm và nhận transcript trực tiếp.");
      setFallbackWarning(event.fallback_active ? "Đang chép lời dự phòng." : "");
      if (translationEnabled.current && targetLanguage) {
        socket.current?.enableTranslation(targetLanguage, missingTranslationIds());
      }
    }
    if (event.type === "transcript.drafts") {
      for (const draft of event.drafts) {
        if (!finalTurnIds.current.has(draft.stream_segment_id)) onTranscript({ ...draft, recognition_status: "unconfirmed" });
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
    if (event.type === "translation.status") {
      setTranslationStatus(event.enabled ? "Đang dịch trực tiếp các đoạn đã được xác nhận." : "");
    }
    if (event.type === "translation.partial") {
      onPartialTranslation?.(event.stream_segment_id, event.text, event.source_text);
      setTranslationStatus("Đang dịch đuổi theo lời nói.");
    }
    if ((event as any).type === "translations.snapshot") {
      const snapshot = (event as any).translations || {};
      const batch: Record<string, RealtimeTranslation> = {};
      for (const [id, text] of Object.entries(snapshot)) {
        translatedSegmentIds.current.add(id);
        batch[id] = {
          text: text as string,
          sourceLanguage: "vi",
          targetLanguage: targetLanguage || "en",
        };
      }
      if (onTranslationsSnapshot) {
        onTranslationsSnapshot(batch);
      }
      setTranslationStatus("Đã tải bản dịch đã lưu.");
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
      setStatus(translateErrorMessage(event.code, event.message || "Lỗi realtime."));
      if (event.retryable === false) {
        browserSpeech.current?.cancel();
        socket.current?.close();
        setState("failed");
        void releaseCapture(false);
      }
    }
  }

  async function start() {
    if (savingSttMode) return;
    if (sttMode === "browser" && !browserSpeechSupported()) {
      setStatus("Trình duyệt không hỗ trợ Web Speech. Hãy dùng Chrome trên máy tính hoặc chọn Cloud trước khi ghi âm.");
      setState("failed");
      return;
    }
    let token = await getValidAccessToken();
    if (!token) {
      token = accessToken;
    }
    if (!token) {
      setStatus("Vui lòng đăng nhập để tiếp tục ghi âm.");
      setState("failed");
      return;
    }
    try {
      browserSpeech.current?.cancel();
      await releaseCapture(false);
      socket.current?.close();
      setState("connecting");
      setStatus("Đang xin quyền microphone và kết nối…");
      capture.current = await MicrophonePcmCapture.open((chunk) => {
        if (socket.current?.isConnected) sessionAudioBytes.current += chunk.byteLength;
        socket.current?.sendAudio(chunk);
        browserSpeech.current?.observeAudio(chunk);
        onAudioChunk?.(chunk);
      });
      socket.current = new MeetingSocket(meetingId, () => getValidAccessToken().then((t) => t || token), event, (next) => {
        if (next === "reconnecting") {
          browserSpeech.current?.cancel();
          onRecognitionInterrupted();
          void capture.current?.pause();
          setStatus("Mất kết nối, đang thử kết nối lại…");
        }
        if (next === "closed") {
          browserSpeech.current?.cancel();
          onRecognitionInterrupted();
          void releaseCapture(false);
          setState((current) => (current === "stopped" || current === "stopping" ? "stopped" : "failed"));
        }
      });
      socket.current.connect();
    } catch (cause) {
      await releaseCapture(false);
      setState("failed");
      setStatus(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Cần cấp quyền microphone để ghi âm."
          : (cause as Error).message
      );
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
    await browserSpeech.current?.stop();
    await capture.current?.pause();
    socket.current?.command("recording.pause");
    maxElapsedRef.current = Math.max(maxElapsedRef.current, elapsed);
    elapsedBeforePause.current = maxElapsedRef.current;
    setState("paused");
    setStatus("Đã tạm dừng ghi âm.");
  }

  async function resume() {
    socket.current?.command("recording.resume");
    await capture.current?.resume();
    browserSpeech.current?.start();
    maxElapsedRef.current = Math.max(maxElapsedRef.current, elapsed);
    elapsedBeforePause.current = maxElapsedRef.current;
    startedAt.current = Date.now();
    setState("recording");
    setStatus("Đang tiếp tục ghi âm.");
  }

  async function stop(silent = false) {
    if (silent) {
      browserSpeech.current?.cancel();
      socket.current?.close();
      await releaseCapture(false);
      return;
    }
    setState("stopping");
    setStatus("Đang hoàn tất transcript và kết thúc bản ghi…");
    await browserSpeech.current?.stop();
    await releaseCapture(true);
    if (socket.current && socket.current.isConnected) {
      socket.current.command("recording.stop");
      window.setTimeout(async () => {
        try {
          await meetingsApi.complete(meetingId);
        } catch {
          // ignore
        }
        setState("stopped");
        setStatus("Đã kết thúc ghi âm.");
        onComplete();
      }, 5000);
      return;
    }
    try {
      await meetingsApi.complete(meetingId);
      setState("stopped");
      setStatus("Đã kết thúc ghi âm.");
      onComplete();
    } catch {
      // ignore
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

  return (
    <div className="bocbang-floating-bar-wrap recording-stt-bar">
      {state === "failed" && status && (
        <div className="bocbang-error-toast">
          <span>{status}</span>
          <button
            type="button"
            onClick={() => setStatus("")}
            title="Đóng thông báo"
          >
            ×
          </button>
        </div>
      )}
      <div className="bocbang-floating-bar">
        {/* 1. Timer Capsule Pill */}
        <div className="bocbang-timer-pill" title="Thời lượng ghi âm">
          <span
            className={`bocbang-timer-dot ${
              state === "recording" ? "is-recording" : state === "paused" ? "is-paused" : ""
            }`}
          />
          <div className="bocbang-timer-content">
            <span className="bocbang-timer-digits">{formatDuration(elapsed)}</span>
            <span className="bocbang-timer-status">
              {state === "recording"
                ? "Đang ghi âm"
                : state === "paused"
                ? "Tạm dừng"
                : state === "connecting"
                ? "Đang kết nối mic…"
                : state === "stopping"
                ? "Đang lưu…"
                : state === "stopped"
                ? "Đã kết thúc"
                : state === "failed"
                ? "Lỗi kết nối"
                : hasStartedBefore
                ? "Đã ghi âm"
                : "Sẵn sàng"}
            </span>
          </div>
        </div>

        {/* 2. Recording Action Controls */}
        <SttModeSelector inline mode={sttMode} onChange={async mode => {
          setSavingSttMode(true);
          try { await onSttModeChange?.(mode); }
          finally { setSavingSttMode(false); }
        }} disabled={modeLocked || hasStartedBefore || !["idle", "failed"].includes(state)} />
        {sttMode === "browser" && <label className="browser-stt-language"
          title="Ngôn ngữ Web Speech. Không tự nhận diện người nói; mốc thời gian ước lượng.">
          <select aria-label="Ngôn ngữ Web Speech" value={languageMode === "en" ? "en" : "vi"}
            disabled={!["idle", "failed", "stopped"].includes(state)}
            onChange={e => onLanguageModeChange?.(e.target.value as "vi" | "en")}>
            <option value="vi">VI</option><option value="en">EN</option>
          </select>
        </label>}
        {(state === "idle" || state === "failed" || state === "stopped") && (
          <button
            type="button"
            className="bocbang-circle-btn btn-mic"
            onClick={() => void start()}
            title={state === "failed" ? "Kết nối lại" : hasStartedBefore ? "Tiếp tục ghi âm" : "Bắt đầu ghi âm"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="22"/>
              <line x1="8" y1="22" x2="16" y2="22"/>
            </svg>
            <span className="bocbang-tooltip">{state === "failed" ? "Kết nối lại" : "Bắt đầu ghi âm"}</span>
          </button>
        )}

        {state === "connecting" && (
          <button type="button" className="bocbang-circle-btn btn-mic is-loading" disabled title="Đang kết nối mic…">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
            </svg>
            <span className="bocbang-tooltip">Đang kết nối mic…</span>
          </button>
        )}

        {state === "recording" && (
          <>
            <button
              type="button"
              className="bocbang-circle-btn btn-pause"
              onClick={() => setConfirmAction("pause")}
              title="Tạm dừng ghi âm"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <rect x="6" y="4" width="3.5" height="16" rx="1" />
                <rect x="14.5" y="4" width="3.5" height="16" rx="1" />
              </svg>
              <span className="bocbang-tooltip">Tạm dừng</span>
            </button>
            <button
              type="button"
              className="bocbang-circle-btn btn-stop"
              onClick={() => setConfirmAction("stop")}
              title="Kết thúc và lưu bản ghi"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
              <span className="bocbang-tooltip">Kết thúc</span>
            </button>
          </>
        )}

        {state === "paused" && (
          <>
            <button
              type="button"
              className="bocbang-circle-btn btn-mic"
              onClick={() => void resume()}
              title="Tiếp tục ghi âm"
            >
              <Icon name="play" />
              <span className="bocbang-tooltip">Tiếp tục ghi âm</span>
            </button>
            <button
              type="button"
              className="bocbang-circle-btn btn-stop"
              onClick={() => setConfirmAction("stop")}
              title="Kết thúc và lưu bản ghi"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="5" width="14" height="14" rx="2" />
              </svg>
              <span className="bocbang-tooltip">Kết thúc</span>
            </button>
          </>
        )}

        {state === "stopping" && (
          <button type="button" className="bocbang-circle-btn btn-mic is-loading" disabled title="Đang lưu…">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="12" />
            </svg>
            <span className="bocbang-tooltip">Đang lưu…</span>
          </button>
        )}

        {/* 3. Speaker / Audio Playback Button */}
        <button
          type="button"
          className="bocbang-circle-btn"
          onClick={onPlayback}
          title="Phát lại bản ghi"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
          <span className="bocbang-tooltip">Phát lại bản ghi</span>
        </button>


        {/* 5. Meeting Sections Grid Button */}
        {onSections && (
          <button
            type="button"
            className={`bocbang-circle-btn ${activeMainView === "sections" ? "is-active" : ""}`}
            onClick={onSections}
            title="Bố cục phiên họp"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="12" y1="3" x2="12" y2="21" />
            </svg>
            <span className="bocbang-tooltip">Bố cục phiên họp</span>
          </button>
        )}

        {/* 6. AI Polish Button */}
        {onPolish && (
          <button
            type="button"
            className={`bocbang-circle-btn ${isPolishBusy ? "is-loading" : ""} ${activeMainView === "polish" ? "is-active" : ""}`}
            onClick={onPolish}
            title="Làm mịn AI"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3L12 3z" />
              <line x1="19" y1="5" x2="19" y2="9" />
              <line x1="17" y1="7" x2="21" y2="7" />
            </svg>
            <span className="bocbang-tooltip">Làm mịn AI</span>
          </button>
        )}

        {/* 7. AI Summary Button */}
        <button
          type="button"
          className="bocbang-circle-btn"
          onClick={onSummary}
          title="Tóm tắt AI"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
            <polyline points="10 9 9 9 8 9" />
          </svg>
          <span className="bocbang-tooltip">Tóm tắt AI</span>
        </button>

        {/* 8. Speakers Management Button */}
        <button
          type="button"
          className="bocbang-circle-btn"
          onClick={onSpeakers}
          title="Quản lý người nói"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="8.5" cy="7" r="4" />
            <line x1="20" y1="8" x2="20" y2="14" />
            <line x1="23" y1="11" x2="17" y2="11" />
          </svg>
          <span className="bocbang-tooltip">Quản lý người nói</span>
        </button>

        {/* Live Share Button */}
        <button
          type="button"
          className="bocbang-circle-btn"
          onClick={onShare}
          title="Chia sẻ cuộc họp trực tiếp (Mã QR / Liên kết)"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          <span className="bocbang-tooltip">Chia sẻ trực tiếp</span>
        </button>

        {/* 9. Download / Export Button */}
        {onExport && (
          <button
            type="button"
            className="bocbang-circle-btn"
            onClick={onExport}
            title="Xuất nội dung (PDF, Word, Audio)"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            <span className="bocbang-tooltip">Xuất nội dung</span>
          </button>
        )}
      </div>
      {/* Confirmation Modal for Pause and Stop */}
      {confirmAction && typeof document !== "undefined" && createPortal(
        <div className="confirm-modal-backdrop" onClick={() => setConfirmAction(null)}>
          <div className="confirm-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="confirm-modal-header">
              <div className={`confirm-icon-badge ${confirmAction === "stop" ? "is-danger" : "is-warning"}`}>
                <Icon name={confirmAction === "stop" ? "stop" : "pause"} />
              </div>
              <div>
                <h3 className="confirm-modal-title">
                  {confirmAction === "stop" ? "Xác nhận kết thúc cuộc họp?" : "Tạm dừng cuộc họp?"}
                </h3>
                <p className="confirm-modal-desc">
                  {confirmAction === "stop"
                    ? "Bạn có chắc chắn muốn kết thúc cuộc họp? Toàn bộ nội dung và phân đoạn sẽ được chốt và lưu lại."
                    : "Bạn có chắc chắn muốn tạm dừng ghi âm cuộc họp không? Bạn có thể tiếp tục bất cứ lúc nào."}
                </p>
              </div>
            </div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConfirmAction(null)}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className={`btn ${confirmAction === "stop" ? "btn-danger" : "btn-primary"}`}
                onClick={() => {
                  const action = confirmAction;
                  setConfirmAction(null);
                  if (action === "pause") {
                    void pause();
                  } else if (action === "stop") {
                    void stop();
                  }
                }}
              >
                {confirmAction === "stop" ? "Kết thúc cuộc họp" : "Tạm dừng"}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function ConfirmDialog({
  title,
  detail,
  confirmLabel,
  close,
  confirm,
}: {
  title: string;
  detail: string;
  confirmLabel: string;
  close: () => void;
  confirm: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="alertdialog" aria-modal="true" style={{ width: 440 }}>
        <h2>{title}</h2>
        <p>{detail}</p>
        <div className="dialog-actions">
          <Button onClick={close}>Hủy</Button>
          <Button tone="danger" onClick={confirm}>
            {confirmLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}

function RenameMeetingDialog({
  title,
  close,
  confirm,
}: {
  title: string;
  close: () => void;
  confirm: (title: string) => Promise<void>;
}) {
  const [value, setValue] = useState(title);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const next = value.trim();
    if (!next) return setError("Tên bản ghi không được để trống.");
    try {
      setSaving(true);
      setError("");
      await confirm(next);
    } catch (cause) {
      setError((cause as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="dialog-backdrop">
      <form className="dialog" onSubmit={submit} style={{ width: 440 }}>
        <button className="close" onClick={close} type="button">
          ×
        </button>
        <h2>Đổi tên bản ghi</h2>
        <label style={{ marginTop: 14 }}>
          Tên bản ghi
          <input autoFocus maxLength={200} value={value} onChange={(event) => setValue(event.target.value)} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="dialog-actions" style={{ marginTop: 20 }}>
          <Button onClick={close}>Hủy</Button>
          <Button type="submit" tone="dark" disabled={saving}>
            {saving ? "Đang lưu…" : "Lưu tên"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function SplitDialog({
  segment,
  close,
  confirm,
}: {
  segment: Segment;
  close: () => void;
  confirm: (splitAt: number, first: string, second: string) => void;
}) {
  const words = segment.text.trim().split(/\s+/);
  const [splitIndex, setSplitIndex] = useState<number>(Math.max(1, Math.floor(words.length / 2)));
  const firstText = words.slice(0, splitIndex).join(" ").trim();
  const secondText = words.slice(splitIndex).join(" ").trim();
  const ratio = firstText.length / (firstText.length + secondText.length || 1);
  const estimatedSplitMs = Math.floor(segment.start_ms + (segment.end_ms - segment.start_ms) * ratio);
  const splitAtMs = Math.max(segment.start_ms + 1, Math.min(segment.end_ms - 1, estimatedSplitMs));

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="dialog" role="dialog" aria-modal="true" style={{ width: 600 }}>
        <h2>Tách bằng câu</h2>
        <p>Nhấp vào chữ bên dưới để chọn vị trí tách. Đoạn sẽ được chia làm hai.</p>
        <div className="split-text">
          {words.map((word, i) => (
            <span
              key={i}
              onClick={() => setSplitIndex(Math.max(1, i))}
              className={`${i >= splitIndex ? "second" : ""} ${i === splitIndex ? "split-point" : ""}`}
            >
              {word}
              {i < words.length - 1 ? " " : ""}
            </span>
          ))}
        </div>
        <div className="split-preview">
          <div>
            <strong>Đoạn 1</strong>
            <p>{firstText}</p>
          </div>
          <div>
            <strong>Đoạn 2</strong>
            <p>{secondText}</p>
          </div>
        </div>
        <div className="dialog-actions">
          <Button onClick={close}>Hủy</Button>
          <Button
            tone="dark"
            disabled={!firstText || !secondText}
            onClick={() => confirm(splitAtMs, firstText, secondText)}
          >
            Tách đoạn
          </Button>
        </div>
      </section>
    </div>
  );
}

function meetingErrorMessage(cause: unknown) {
  if (cause instanceof ApiError) {
    if (cause.code === "SEGMENTS_NOT_MERGEABLE") return "Các đoạn được chọn phải nằm liền nhau.";
    if (cause.code === "USER_NOT_FOUND") return "Email này chưa có tài khoản Bóc Băng.";
  }
  const message = cause instanceof Error ? cause.message : "Không thể thực hiện thao tác.";
  if (message === "Segments must be contiguous and have the same speaker.")
    return "Chỉ có thể gộp hai đoạn liền kề của cùng một người nói.";
  return message;
}

function formatTime(milliseconds?: number) {
  if (milliseconds === undefined) return "--:--";
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function formatDuration(seconds: number) {
  return `${Math.floor(seconds / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

/* ═══════════════════════════════════════════
   MODAL: VIEW LOG AI (ẢNH 4)
═══════════════════════════════════════════ */
function LogAiModal({ close, meetingTitle }: { close: () => void; meetingTitle: string }) {
  const logs = [
    { time: "10:14:02.12", level: "CONNECT", msg: `Phiên kết nối STT khởi tạo cho "${meetingTitle}"` },
    { time: "10:14:02.35", level: "AUDIO", msg: "Microphone PCM / Audio streaming active (16kHz, mono)" },
    { time: "10:14:03.90", level: "MODEL", msg: "Pipeline: Gemini Flash Realtime Engine initialized" },
    { time: "10:14:04.18", level: "STT", msg: "Segment chunk decoded (confidence: 0.985, latency: 118ms)" },
    { time: "10:14:04.22", level: "DIARIZATION", msg: "Voice embedding matched: Speaker 1" },
    { time: "10:14:07.45", level: "TRANSLATE", msg: "Realtime bilingual sync (VI <-> EN) active" },
    { time: "10:14:12.80", level: "SYNC", msg: "Audio-transcript timestamp synchronized" },
  ];

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div
        className="dialog ai-diagnostics-modal"
        style={{ width: 620, maxWidth: "94vw" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>⚡</span>
            <h2 style={{ margin: 0, fontSize: 16 }}>AI Real-time Diagnostics Log</h2>
          </div>
          <button className="close" onClick={close} type="button">
            ×
          </button>
        </div>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--muted)" }}>
          Thông tin chi tiết về pipeline bóc băng, nhận diện người nói và độ trễ mô hình AI.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <span style={{ fontSize: 11, background: "rgba(16, 185, 129, 0.2)", color: "#34d399", padding: "3px 8px", borderRadius: 4, fontWeight: 600 }}>
            ● CONNECTED
          </span>
          <span style={{ fontSize: 11, background: "rgba(59, 130, 246, 0.2)", color: "#60a5fa", padding: "3px 8px", borderRadius: 4, fontWeight: 600 }}>
            Gemini STT
          </span>
          <span style={{ fontSize: 11, background: "rgba(245, 158, 11, 0.2)", color: "#fbbf24", padding: "3px 8px", borderRadius: 4, fontWeight: 600 }}>
            Latency: ~118ms
          </span>
        </div>

        <div
          style={{
            background: "#030712",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            padding: 12,
            height: 260,
            overflowY: "auto",
            fontFamily: "monospace",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {logs.map((item, idx) => (
            <div key={idx} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <span style={{ color: "#6b7280" }}>[{item.time}]</span>
              <span
                style={{
                  color:
                    item.level === "CONNECT"
                      ? "#34d399"
                      : item.level === "MODEL"
                      ? "#a78bfa"
                      : item.level === "STT"
                      ? "#38bdf8"
                      : "#fbbf24",
                  fontWeight: 700,
                }}
              >
                [{item.level}]
              </span>
              <span style={{ color: "#e5e7eb" }}>{item.msg}</span>
            </div>
          ))}
        </div>

        <div className="dialog-actions" style={{ marginTop: 16 }}>
          <Button tone="dark" onClick={close}>
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}


/* ═══════════════════════════════════════════
   MODAL: CHIA SẺ SOCIAL (ẢNH 1)
═══════════════════════════════════════════ */
function ShareSocialModal({ meetingTitle, close }: { meetingTitle: string; close: () => void }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = window.location.href;

  function handleCopy() {
    void copyToClipboard(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function openShare(type: string) {
    const encodedUrl = encodeURIComponent(shareUrl);
    const encodedTitle = encodeURIComponent(meetingTitle);
    let url = "";
    if (type === "facebook") url = `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`;
    else if (type === "messenger") url = `https://www.facebook.com/dialog/send?link=${encodedUrl}&app_id=1091931238593&redirect_uri=${encodedUrl}`;
    else if (type === "x") url = `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`;
    else if (type === "telegram") url = `https://t.me/share/url?url=${encodedUrl}&text=${encodedTitle}`;
    else if (type === "whatsapp") url = `https://api.whatsapp.com/send?text=${encodedTitle}%20${encodedUrl}`;
    else if (type === "viber") url = `viber://forward?text=${encodedTitle}%20${encodedUrl}`;
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="share-social-card" onClick={(e) => e.stopPropagation()}>
        <div className="share-social-header">
          <strong>Chia sẻ</strong>
          <button type="button" className="close" onClick={close} aria-label="Đóng">✕</button>
        </div>
        {copied && <div className="share-social-copied-toast">Đã sao chép liên kết vào bộ nhớ tạm!</div>}
        <div className="share-social-grid">
          <button type="button" className="share-social-btn" onClick={handleCopy}>
            <span className="share-social-icon copy-icon">🔗</span>
            <small>Copy Link</small>
          </button>
          <button type="button" className="share-social-btn" onClick={() => openShare("facebook")}>
            <span className="share-social-icon fb-icon">f</span>
            <small>Facebook</small>
          </button>
          <button type="button" className="share-social-btn" onClick={() => openShare("messenger")}>
            <span className="share-social-icon msg-icon">💬</span>
            <small>Messenger</small>
          </button>
          <button type="button" className="share-social-btn" onClick={() => openShare("x")}>
            <span className="share-social-icon x-icon">𝕏</span>
            <small>X</small>
          </button>
          <button type="button" className="share-social-btn" onClick={() => openShare("telegram")}>
            <span className="share-social-icon tg-icon">✈</span>
            <small>Telegram</small>
          </button>
          <button type="button" className="share-social-btn" onClick={() => openShare("whatsapp")}>
            <span className="share-social-icon wa-icon">📞</span>
            <small>WhatsApp</small>
          </button>
          <button type="button" className="share-social-btn" onClick={() => openShare("viber")}>
            <span className="share-social-icon vb-icon">📱</span>
            <small>Viber</small>
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MODAL: XUẤT NỘI DUNG (ẢNH 4)
═══════════════════════════════════════════ */
function ExportContentModal({
  meetingId,
  meetingTitle,
  mediaId,
  close,
}: {
  meetingId: string;
  meetingTitle: string;
  mediaId?: string;
  close: () => void;
}) {
  const [loading, setLoading] = useState<string | null>(null);

  async function handleExport(format: "pdf" | "docx" | "audio") {
    if (format === "audio") {
      if (!mediaId) {
        alert("Bản ghi chưa có tệp âm thanh.");
        return;
      }
      try {
        setLoading("audio");
        const blob = await recordingApi.download(meetingId, mediaId || "");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${meetingTitle || "cuoc_hop"}.m4a`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        close();
      } catch (err) {
        alert("Không thể tải tệp âm thanh: " + (err as Error).message);
      } finally {
        setLoading(null);
      }
      close();
      return;
    }

    try {
      setLoading(format);
      const artifact = await meetingsApi.export(meetingId, format, {
        include_timestamps: true,
        include_speakers: true,
        include_translation: true,
        include_summary: false,
        content_mode: "bilingual",
      });
      let currentArtifact = artifact;
      const start = Date.now();
      while (currentArtifact.status !== "completed" && currentArtifact.status !== "failed" && Date.now() - start < 20000) {
        await new Promise((r) => setTimeout(r, 600));
        currentArtifact = await meetingsApi.getExport(currentArtifact.id);
      }
      if (currentArtifact.status === "failed") {
        throw new Error("Không thể tạo tệp xuất. Vui lòng thử lại.");
      }
      const blob = await meetingsApi.downloadExport(currentArtifact.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = artifact.filename ?? `${meetingTitle}.${format === "docx" ? "docx" : "pdf"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      close();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="export-content-modal" onClick={(e) => e.stopPropagation()}>
        <div className="export-content-header">
          <strong>Xuất nội dung</strong>
          <button type="button" className="close" onClick={close} aria-label="Đóng">✕</button>
        </div>
        <div className="export-content-buttons">
          <button
            type="button"
            className="export-btn-primary"
            onClick={() => void handleExport("pdf")}
            disabled={loading !== null}
          >
            {loading === "pdf" ? "Đang xuất PDF…" : "Xuất PDF"}
          </button>
          <button
            type="button"
            className="export-btn-secondary"
            onClick={() => void handleExport("docx")}
            disabled={loading !== null}
          >
            {loading === "docx" ? "Đang xuất DOC…" : "Xuất DOC"}
          </button>
          <button
            type="button"
            className="export-btn-secondary"
            onClick={() => void handleExport("audio")}
            disabled={loading !== null}
          >
            Xuất Audio
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MODAL: QUẢN LÝ NGƯỜI NÓI (ẢNH 5)
═══════════════════════════════════════════ */
function SpeakerManagementModal({
  meetingId,
  speakers,
  editable,
  close,
  isFullScreen,
}: {
  isFullScreen?: boolean;
  meetingId: string;
  speakers: any;
  editable: boolean;
  close: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [organization, setOrganization] = useState("");
  const [loading, setLoading] = useState(false);

  // Search filter
  const [searchName, setSearchName] = useState("");
  const [searchRole, setSearchRole] = useState("");
  const [searchOrg, setSearchOrg] = useState("");

  const profiles = useAsync(() => voiceProfilesApi.listMeetingProfiles(meetingId), [meetingId]);

  const systemSpeakers = useMemo(() => {
    if (!profiles.data || profiles.data.length === 0) {
      return [
        { id: "def-1", name: "Người tham gia mẫu", role: "Thành viên", organization: "Tổ chức" },
      ];
    }
    return profiles.data.map((p) => ({
      id: p.id,
      name: p.name,
      role: `Hồ sơ giọng (${p.sample_count}/3 mẫu)`,
      organization: p.user_id ? "Người dùng" : "Cuộc họp",
    }));
  }, [profiles.data]);

  const currentSpeakers: any[] = speakers.data ?? [];

  async function handleCreateSpeaker(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!fullName.trim()) return;
    try {
      setLoading(true);
      const created = await meetingsApi.createSpeaker(meetingId, {
        name: fullName.trim(),
        role: role.trim() || undefined,
        organization: organization.trim() || undefined,
      });
      speakers.setData((cur: any) => [...(cur ?? []), created]);
      setFullName("");
      setRole("");
      setOrganization("");
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleAddFromSystem(spk: { name: string; role?: string; organization?: string }) {
    try {
      setLoading(true);
      const created = await meetingsApi.createSpeaker(meetingId, {
        name: spk.name,
        role: spk.role || undefined,
        organization: spk.organization || undefined,
      });
      speakers.setData((cur: any) => [...(cur ?? []), created]);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveSpeaker(id: string) {
    try {
      await meetingsApi.deleteSpeaker(id);
      speakers.setData((cur: any) => cur?.filter((s: any) => s.id !== id));
    } catch (e) {
      alert((e as Error).message);
    }
  }

  const [page, setPage] = useState(1);
  const pageSize = 5;

  const filteredSystem = systemSpeakers.filter((s) => {
    if (searchName && !s.name.toLowerCase().includes(searchName.toLowerCase())) return false;
    if (searchRole && !s.role.toLowerCase().includes(searchRole.toLowerCase())) return false;
    if (searchOrg && !s.organization.toLowerCase().includes(searchOrg.toLowerCase())) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filteredSystem.length / pageSize));
  const pagedSystem = filteredSystem.slice((page - 1) * pageSize, page * pageSize);

    const speakerBody = (
    <div className={isFullScreen ? "dedicated-feature-body" : "speaker-modal-body"}>
      <div className="speaker-modal-grid">
          {/* Left Column */}
          <div className="speaker-modal-col left">
            <h4>Tạo người tham gia mới</h4>
            <div className="speaker-create-inputs">
              <label>
                <span>Tên đầy đủ <b style={{ color: "#ef4444" }}>*</b></span>
                <input
                  type="text"
                  placeholder="Nhập tên người tham gia"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </label>
              <label>
                <span>Chức danh</span>
                <input
                  type="text"
                  placeholder="Nhập chức danh"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </label>
              <label>
                <span>Đơn vị công tác</span>
                <input
                  type="text"
                  placeholder="Nhập đơn vị công tác"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                />
              </label>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button
                type="button"
                className="speaker-add-btn"
                onClick={() => void handleCreateSpeaker()}
                disabled={!fullName.trim() || loading}
              >
                + Thêm người tham gia
              </button>
            </div>

            <h4 style={{ marginTop: 20 }}>Thêm người tham gia từ hệ thống</h4>
            <div className="speaker-search-bar">
              <input
                type="text"
                placeholder="Tên"
                value={searchName}
                onChange={(e) => setSearchName(e.target.value)}
              />
              <input
                type="text"
                placeholder="Chức Danh"
                value={searchRole}
                onChange={(e) => setSearchRole(e.target.value)}
              />
              <input
                type="text"
                placeholder="Đơn vị"
                value={searchOrg}
                onChange={(e) => setSearchOrg(e.target.value)}
              />
              <button type="button" className="speaker-search-btn">Tìm kiếm</button>
            </div>

            <div className="speaker-table-wrap">
              <table className="speaker-table">
                <thead>
                  <tr>
                    <th>Tên</th>
                    <th>Chức Danh</th>
                    <th>Đơn vị</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedSystem.map((spk, idx) => (
                    <tr key={idx}>
                      <td><strong>{spk.name}</strong></td>
                      <td>{spk.role || "—"}</td>
                      <td>{spk.organization || "—"}</td>
                      <td style={{ textAlign: "right" }}>
                        <button
                          type="button"
                          className="speaker-join-btn"
                          onClick={() => void handleAddFromSystem(spk)}
                          disabled={loading}
                        >
                          + Thêm vào cuộc họp
                        </button>
                        {spk.id && !spk.id.startsWith("def-") && (
                          <button
                            type="button"
                            title="Xóa mẫu giọng nói này"
                            onClick={async () => {
                              if (!window.confirm(`Bạn có chắc chắn muốn xóa mẫu giọng của "${spk.name}"?`)) return;
                              try {
                                await voiceProfilesApi.delete(spk.id);
                                void profiles.reload();
                              } catch (err) {
                                alert((err as Error).message);
                              }
                            }}
                            style={{
                              marginLeft: "6px",
                              padding: "4px 8px",
                              borderRadius: "6px",
                              border: "1px solid var(--danger, #ef4444)",
                              background: "transparent",
                              color: "var(--danger, #ef4444)",
                              cursor: "pointer",
                              fontSize: "12px",
                            }}
                          >
                            Xóa
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination (Ảnh 5) */}
            <div className="speaker-pagination">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                title="Trang trước"
              >
                &lt;
              </button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <button
                  key={p}
                  type="button"
                  className={page === p ? "active" : ""}
                  onClick={() => setPage(p)}
                >
                  {p}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                title="Trang sau"
              >
                &gt;
              </button>
            </div>
          </div>

          {/* Right Column */}
          <div className="speaker-modal-col right">
            <h4>Người đã tham gia</h4>
            <div className="speaker-table-wrap">
              <table className="speaker-table">
                <thead>
                  <tr>
                    <th>Tên</th>
                    <th>Chức Danh</th>
                    <th>Đơn vị</th>
                    <th style={{ textAlign: "right" }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {currentSpeakers.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center", padding: "60px 20px" }}>
                        <div style={{ color: "var(--muted)", fontSize: 32, marginBottom: 8 }}>📥</div>
                        <div style={{ color: "var(--muted)", fontSize: 13 }}>No data</div>
                      </td>
                    </tr>
                  ) : (
                    currentSpeakers.map((spk: any) => (
                      <tr key={spk.id}>
                        <td><strong>{spk.name}</strong></td>
                        <td>{spk.role || "—"}</td>
                        <td>{spk.organization || "—"}</td>
                        <td style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            className="speaker-remove-btn"
                            onClick={() => void handleRemoveSpeaker(spk.id)}
                          >
                            Xóa
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      {!isFullScreen && (
        <div className="speaker-modal-footer">
          <button type="button" className="btn btn-ghost" onClick={close}>Cancel</button>
          <button type="button" className="btn btn-primary-blue" onClick={close}>OK</button>
        </div>
      )}
    </div>
  );

  if (isFullScreen) {
    return (
      <div className="dedicated-feature-view speaker-dedicated-view">
        {speakerBody}
      </div>
    );
  }

  return (
    <div className="dialog-backdrop" onClick={close}>
      <div className="speaker-modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="speaker-modal-header">
          <strong>Quản lý người nói</strong>
          <button type="button" className="close" onClick={close} aria-label="Đóng">✕</button>
        </div>
        {speakerBody}
      </div>
    </div>
  );
}
