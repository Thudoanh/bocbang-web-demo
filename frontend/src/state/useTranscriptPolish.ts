import { useEffect, useRef, useState } from "react";
import { capabilitiesApi, meetingsApi, transcriptPolishApi } from "../api/endpoints";
import { ApiError } from "../api/client";
import { MEETING_TRANSCRIPT_CHANGED, MEETINGS_CHANGED, notifyMeetingTranscriptChanged } from "../api/meetingEvents";
import type { TranscriptPolish } from "../types/domain";
import { isPolishPending, isPolishStale, polishToolState, type PolishContext } from "../utils/transcriptPolish";
import { can } from "../utils/permissions";

function errorMessage(cause: unknown) {
  if (cause instanceof ApiError && cause.code === "VERSION_CONFLICT") return "Transcript hoặc bản nháp đã thay đổi. Tải lại bản nháp để kiểm tra; các sửa chưa lưu vẫn được giữ tại đây.";
  return cause instanceof Error ? cause.message : "Không thể xử lý transcript. Vui lòng thử lại.";
}

/** One owner for polling, proposal and unsaved edits, shared by the toolbar and dialog. */
export function useTranscriptPolish(meetingId: string) {
  const [context, setContext] = useState<PolishContext>();
  const [proposal, setProposal] = useState<TranscriptPolish | null>();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [original, setOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState("");
  const [queryError, setQueryError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const capabilities = useRef<boolean | undefined>(undefined);
  const dirty = Boolean(proposal && proposal.segments.some((row) => (draft[row.logical_segment_id] ?? row.text) !== row.text));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const refresh = () => setReload((value) => value + 1);

  function adopt(value: TranscriptPolish | null) {
    setProposal(value);
    setDraft(Object.fromEntries(value?.segments.map((row) => [row.logical_segment_id, row.text]) ?? []));
    dirtyRef.current = false;
  }

  useEffect(() => {
    if (busy) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const poll = async () => {
      let delay = 10000;
      try {
        const meeting = await meetingsApi.get(meetingId);
        const next: PolishContext = { meeting, available: capabilities.current ?? false };
        let latest: TranscriptPolish | null = null;
        if (meeting.status === "completed") {
          if (capabilities.current === undefined) capabilities.current = Boolean((await capabilitiesApi.get()).transcript_polish);
          next.available = capabilities.current;
          try {
            const transcript = await meetingsApi.transcript(meetingId, { limit: 1 });
            next.hasTranscript = Boolean(transcript.segments.length);
            next.versionId = transcript.version_id;
          } catch (cause) {
            if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
            next.hasTranscript = false;
          }
          if (next.hasTranscript) latest = await transcriptPolishApi.latest(meetingId, controller.signal);
          delay = isPolishPending(latest) ? 2000 : 0;
        }
        if (controller.signal.aborted || inFlight.current) return;
        setContext(next); setQueryError("");
        // Never replace a user's unsaved text or its expected server revision on refresh.
        if (!dirtyRef.current) adopt(latest);
      } catch (cause) {
        if (controller.signal.aborted || inFlight.current) return;
        setQueryError(errorMessage(cause)); delay = 5000;
      }
      if (!controller.signal.aborted && delay) timer = window.setTimeout(poll, delay);
    };
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [meetingId, reload, busy]);

  useEffect(() => {
    const update = (event: Event) => {
      if ((event as CustomEvent<{ meetingId: string }>).detail?.meetingId === meetingId) refresh();
    };
    window.addEventListener(MEETING_TRANSCRIPT_CHANGED, update);
    window.addEventListener(MEETINGS_CHANGED, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(MEETING_TRANSCRIPT_CHANGED, update);
      window.removeEventListener(MEETINGS_CHANGED, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [meetingId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const editable = Boolean(context && can(context.meeting.permission, "edit"));
  const pending = isPolishPending(proposal);
  const accepted = Boolean(proposal?.accepted_version_id);
  const stale = isPolishStale(proposal, context?.versionId);
  const tool = polishToolState(context, proposal, error || queryError);

  async function generate() {
    if (inFlight.current || tool.disabled || !editable || pending || !context?.available || dirtyRef.current) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try { adopt(await transcriptPolishApi.create(meetingId)); setEditing(false); }
    catch (cause) { setError(errorMessage(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function save(accept: boolean) {
    if (inFlight.current || !proposal || !editable || pending || accepted || stale || tool.disabled || queryError) return;
    inFlight.current = true; setBusy(true); setError(""); setNotice("");
    try {
      const result = await transcriptPolishApi.review(meetingId, proposal.job.id, {
        revision: proposal.revision,
        segments: proposal.segments.map((row) => ({ logical_segment_id: row.logical_segment_id, text: draft[row.logical_segment_id] ?? row.text })),
      }, accept);
      adopt(result); setEditing(false);
      setNotice(accept ? "Đã chốt transcript. Bản gốc vẫn được giữ an toàn." : "Đã lưu bản nháp, chưa thay đổi transcript đang sử dụng.");
      if (accept) {
        setContext((current) => current ? { ...current, versionId: result.accepted_version_id ?? current.versionId } : current);
        notifyMeetingTranscriptChanged(meetingId, true);
      }
    } catch (cause) { setError(errorMessage(cause)); }
    finally { inFlight.current = false; setBusy(false); }
  }

  function discard() { adopt(proposal ?? null); setEditing(false); }
  function retry() { if (inFlight.current || dirtyRef.current) return; setError(""); capabilities.current = undefined; refresh(); }
  return { context, proposal, draft, setDraft, editing, setEditing, original, setOriginal, busy, error: error || queryError, queryError,
    notice, dirty, editable, pending, accepted, stale, tool, generate, save, discard, retry, refresh };
}
export type TranscriptPolishReviewState = ReturnType<typeof useTranscriptPolish>;
