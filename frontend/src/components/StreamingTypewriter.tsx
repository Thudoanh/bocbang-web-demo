import { useEffect, useRef, useState } from "react";

/**
 * Reveals newly received live words at a steady cadence.  Speech providers send
 * revised snapshots, so the queue is rebuilt from the longest common prefix
 * instead of appending the same partial words repeatedly.
 */
export function StreamingTypewriter({
  text,
  active,
  className,
}: {
  text: string;
  active: boolean;
  className?: string;
}) {
  const words = text.trim() ? text.trim().split(/\s+/) : [];
  const previousWords = useRef<string[]>([]);
  // Start at zero for an incoming partial so React never paints the entire
  // provider snapshot for one frame before the queue begins typing.
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    const previous = previousWords.current;
    let prefix = 0;
    while (prefix < previous.length && prefix < words.length && previous[prefix] === words[prefix]) {
      prefix += 1;
    }
    previousWords.current = words;
    if (!active) {
      setVisibleCount(words.length);
      return;
    }
    setVisibleCount(prefix);
    if (prefix >= words.length) return;
    const timer = window.setInterval(() => {
      setVisibleCount((current) => {
        const next = Math.min(current + 1, words.length);
        if (next >= words.length) window.clearInterval(timer);
        return next;
      });
    }, 20);
    return () => window.clearInterval(timer);
  }, [text, active, words.length]);

  const visible = words.slice(0, active ? visibleCount : words.length);
  return (
    <span className={className} aria-live="polite">
      {visible.map((word, index) => (
        <span key={`${index}-${word}`} className={active && index >= visible.length - 2 ? "streaming-token" : undefined}>
          {word}{index < visible.length - 1 ? " " : ""}
        </span>
      ))}
      {active && <span className="streaming-cursor">▋</span>}
    </span>
  );
}
