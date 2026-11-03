/** Short readable paragraphs; the latest words remain visibly provisional.
 * The engine may revise every paragraph until it returns a final. */
export function BrowserTranscriptText({ text, active }: { text: string; active: boolean }) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const tailStart = active ? Math.max(0, words.length - 12) : words.length;
  const paragraphs: string[] = [];
  for (let i = 0; i < tailStart; i += 32) paragraphs.push(words.slice(i, Math.min(i + 32, tailStart)).join(" "));
  return <div className="browser-transcript-text" aria-live="polite">
    {paragraphs.map((paragraph, i) => <p key={i} style={{ margin: "0 0 8px", whiteSpace: "pre-wrap" }}>{paragraph}</p>)}
    {active && <span>{words.slice(tailStart).join(" ")}<span className="streaming-cursor">▋</span></span>}
  </div>;
}
