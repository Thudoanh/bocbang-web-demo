import { cloneElement, useId, useState, type ReactElement } from "react";

export function ToolbarTooltip({ label, disabled = false, className = "", children }: {
  label: string; disabled?: boolean; className?: string; children: ReactElement<{ "aria-describedby"?: string }>;
}) {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  return <span className={`toolbar-action${className ? ` ${className}` : ""}${dismissed ? " tooltip-dismissed" : ""}`} tabIndex={disabled ? 0 : undefined}
    aria-label={disabled ? label : undefined} onPointerEnter={() => setDismissed(false)} onFocus={() => setDismissed(false)}
    onKeyDown={(event) => { if (event.key === "Escape") { setDismissed(true); event.stopPropagation(); } }}>
    {cloneElement(children, { "aria-describedby": id })}
    <span id={id} className="toolbar-tooltip" role="tooltip">{label}</span>
  </span>;
}
