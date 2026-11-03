import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { meetingsApi } from "../api/endpoints";
import { useAsync } from "../hooks/useAsync";
import { useTranscriptPolish, type TranscriptPolishReviewState } from "../state/useTranscriptPolish";
import { Failure, Icon } from "./ui";
import { TranscriptPolishReview } from "./TranscriptPolishReview";
import { ToolbarTooltip } from "./ToolbarTooltip";

export function TranscriptPolishTool({ meetingId }: { meetingId: string }) {
  const review = useTranscriptPolish(meetingId);
  const [open, setOpen] = useState(false);
  const { tool } = review;
  return <>
    <span className={`polish-tool polish-tool-${tool.tone}`}><ToolbarTooltip label={`Làm mịn — ${tool.label}. ${tool.reason}`} disabled={tool.disabled}>
      <button type="button" disabled={tool.disabled} aria-label={`Làm mịn: ${tool.label}. ${tool.reason}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? "transcript-polish-dialog" : undefined} className={open ? "selected" : ""} onClick={() => { review.refresh(); setOpen(true); }}>
        <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m11 3 2.5 6.5L20 12l-6.5 2.5L11 21l-2.5-6.5L2 12l6.5-2.5Z" /><path d="M20 2v4m-2-2h4" /></svg>
        <span className="tool-state-dot" aria-hidden="true" />
        <span className="sr-only" aria-live="polite">{tool.label}</span>
      </button>
    </ToolbarTooltip></span>
    {open && createPortal(<TranscriptPolishDialog meetingId={meetingId} review={review} close={() => setOpen(false)} />, document.body)}
  </>;
}

export function TranscriptPolishDialog({ meetingId, review, close, isFullScreen }: { meetingId: string; review: TranscriptPolishReviewState; close: () => void; isFullScreen?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const speakers = useAsync(() => meetingsApi.speakers(meetingId), [meetingId]);
  const [discarding, setDiscarding] = useState(false);

  useEffect(() => {
    if (isFullScreen) return;
    const element = dialog.current;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isFullScreen]);

  useEffect(() => {
    if (review.busy || !review.dirty) setDiscarding(false);
  }, [review.busy, review.dirty]);

  function requestClose() {
    if (review.busy) return;
    if (review.dirty) setDiscarding(true);
    else close();
  }

  const polishContent = (
    <>
{/* Dedicated header moved to topbar */}
      <div className={isFullScreen ? "dedicated-feature-body" : undefined}>
        {speakers.error && <Failure error={speakers.error} retry={speakers.reload} />}
        <TranscriptPolishReview
          review={review}
          speakers={speakers.data ?? []}
          onClose={requestClose}
          discarding={discarding}
          onCancelDiscard={() => setDiscarding(false)}
          onConfirmDiscard={() => {
            review.discard();
            close();
          }}
        />
      </div>
    </>
  );

  if (isFullScreen) {
    return <div className="dedicated-feature-view">{polishContent}</div>;
  }

  return (
    <dialog
      ref={dialog}
      id="transcript-polish-dialog"
      className="dialog transcript-polish-dialog"
      aria-labelledby="polish-title"
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      {polishContent}
    </dialog>
  );
}
