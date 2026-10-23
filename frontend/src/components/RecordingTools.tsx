import { Icon } from "./ui";
import { ToolbarTooltip } from "./ToolbarTooltip";

export type RecordingState = "idle" | "connecting" | "recording" | "pausing" | "resuming" | "paused" | "stopping" | "stopped" | "failed";
export type RecordingStatusTone = "info" | "warning" | "error";
const stateLabels: Record<RecordingState, string> = {
  idle: "Sẵn sàng", connecting: "Đang kết nối", recording: "Đang ghi âm", pausing: "Đang tạm dừng",
  resuming: "Đang tiếp tục", paused: "Tạm dừng", stopping: "Đang kết thúc", stopped: "Đã kết thúc", failed: "Lỗi kết nối",
};

/** Presentation only: lifecycle and confirmation remain owned by RecordingPanel. */
export function RecordingTools({ state, elapsed, status, statusTone = "info", fallbackWarning, translationStatus, hasStartedBefore, onStart, onPause, onResume, onEnd }: {
  state: RecordingState; elapsed: number; status: string; fallbackWarning: string; translationStatus: string;
  statusTone?: RecordingStatusTone;
  hasStartedBefore?: boolean; onStart: () => void; onPause: () => void; onResume: () => void; onEnd: () => void;
}) {
  const time = `${Math.floor(elapsed / 3600).toString().padStart(2, "0")}:${Math.floor((elapsed % 3600) / 60).toString().padStart(2, "0")}:${(elapsed % 60).toString().padStart(2, "0")}`;
  const busy = ["connecting", "pausing", "resuming", "stopping"].includes(state);
  const startLabel = state === "failed" ? "Kết nối lại ghi âm" : hasStartedBefore ? "Tiếp tục ghi âm" : "Bắt đầu ghi âm";
  const statusAlert = Boolean(status && (state === "failed" || statusTone !== "info"));
  const translationError = translationStatus.startsWith("Dịch realtime:");
  const hasAlerts = statusAlert || Boolean(fallbackWarning) || translationError;
  const details = [status || stateLabels[state], translationStatus].filter(Boolean).join(" · ");
  return <>
    <div className="recording-tools" role="group" aria-label="Điều khiển ghi âm">
      <ToolbarTooltip label={details} className="recording-status-tooltip"><div className={`recording-indicator recording-${state}`} tabIndex={0} aria-label={`Ghi âm: ${stateLabels[state]}`}>
        <span className="recording-state-dot" aria-hidden="true" />
        <div><time className="recording-timer" aria-label={`Thời lượng ghi âm ${time}`}>{time}</time><span className="recording-state-label">{stateLabels[state]}</span></div>
      </div></ToolbarTooltip>
      {(state === "idle" || state === "failed") && <ToolbarTooltip label={startLabel}><button type="button" className="recording-start" aria-label={startLabel} onClick={onStart}><Icon name="microphone" /></button></ToolbarTooltip>}
      {state === "recording" && <ToolbarTooltip label="Tạm dừng — chọn tạo phiên mới hoặc giữ nguyên phiên"><button type="button" aria-label="Tạm dừng" aria-haspopup="dialog" onClick={onPause}><Icon name="pause" /></button></ToolbarTooltip>}
      {state === "paused" && <ToolbarTooltip label="Tiếp tục ghi âm"><button type="button" aria-label="Tiếp tục ghi âm" onClick={onResume}><Icon name="play" /></button></ToolbarTooltip>}
      {busy && <ToolbarTooltip label={stateLabels[state]} disabled><button type="button" disabled aria-label={stateLabels[state]}><span className="spinner" /></button></ToolbarTooltip>}
      {(state === "recording" || state === "paused" || ((state === "idle" || state === "failed") && hasStartedBefore)) && <ToolbarTooltip label="Kết thúc cuộc họp"><button type="button" className="recording-end" aria-label="Kết thúc cuộc họp" onClick={onEnd}><Icon name="stop" /></button></ToolbarTooltip>}
    </div>
    <div className="sr-only" role="status">{!statusAlert && status}{!statusAlert && status && !translationError && translationStatus ? " · " : ""}{!translationError && translationStatus}</div>
    {hasAlerts && <div className="recording-feedback">
      {statusAlert && <p className={statusTone === "warning" && state !== "failed" ? "recording-warning" : "recording-error"} role="alert">{status}</p>}
      {fallbackWarning && <p className="recording-warning" role="alert">{fallbackWarning}</p>}
      {translationError && <p className="recording-error" role="alert">{translationStatus}</p>}
    </div>}
  </>;
}
