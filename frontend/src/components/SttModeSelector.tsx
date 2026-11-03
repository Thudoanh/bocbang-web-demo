import { useState } from "react";
import { getDefaultSttMode, setDefaultSttMode, useDefaultSttMode, type SttMode } from "../realtime/sttMode";
import "./SttModeSelector.css";

export function SttModeSelector({ mode, onChange, disabled = false, compact = false, inline = false }: {
  mode?: SttMode; onChange?: (mode: SttMode) => Promise<void> | void;
  disabled?: boolean; compact?: boolean; inline?: boolean;
}) {
  const defaultMode = useDefaultSttMode();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const selected = mode ?? defaultMode;
  const help = mode
    ? `${selected === "browser" ? "STT: Web Speech · Dịch và AI: Cloud" : "STT và AI: Cloud"}. ${disabled ? "Chế độ đã được khóa cho cuộc họp này." : "Chọn STT trước khi bắt đầu ghi âm."}`
    : "Chế độ STT mặc định cho phiên họp mới";
  return <div className={`stt-mode-selector ${compact ? "is-compact" : ""} ${inline ? "is-inline" : ""}`} onClick={e => e.stopPropagation()}>
    <label title={help}>
      <span>{compact ? "STT" : "Chế độ STT"}</span>
      <select aria-label={mode ? "Chế độ STT cuộc họp" : "Chế độ STT cho cuộc họp mới"}
        value={selected} disabled={disabled || saving} title={help}
        onChange={async e => {
          const next = e.target.value as SttMode;
          setSaving(true); setError("");
          try {
            if (onChange) await onChange(next);
            else setDefaultSttMode(next);
          } catch (cause) { setError(cause instanceof Error ? cause.message : "Không thể đổi chế độ STT."); }
          finally { setSaving(false); }
        }}>
        <option value="cloud">Cloud</option>
        <option value="browser">Browser</option>
        <option value="local" disabled>Local — Sắp có</option>
      </select>
    </label>
    {!compact && !inline && <small>{mode ? (selected === "browser" ? "STT: Web Speech · Dịch và AI: Cloud" : "STT và AI: Cloud") : "Áp dụng cho phiên họp microphone mới"}</small>}
    {error && <small role="alert">{error}</small>}
  </div>;
}

export { getDefaultSttMode };
