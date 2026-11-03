/** Ignore legacy failed translations cached as copies of the source transcript. */
export function isUsableTranslation(source: string, translated?: string): boolean {
  const text = translated?.trim();
  if (!text || text === "...") return false;
  const compact = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}_]/gu, "");
  const original = compact(source);
  return !(original.length >= 4 && /\p{L}/u.test(original) && original === compact(text));
}

type SourceSegment = { logical_segment_id: string; text: string };
type StoredTranslation = { segments?: SourceSegment[] };

export function buildTranslationMap(
  segments: SourceSegment[], translations: StoredTranslation[], live: Record<string, { text: string }>,
): Map<string, string> {
  const sources = new Map(segments.map(segment => [segment.logical_segment_id, segment.text]));
  const map = new Map<string, string>();
  for (const translation of [...translations].reverse()) {
    for (const item of translation.segments ?? []) {
      const source = sources.get(item.logical_segment_id);
      if (source !== undefined && isUsableTranslation(source, item.text)) map.set(item.logical_segment_id, item.text);
    }
  }
  for (const [id, item] of Object.entries(live)) {
    const source = sources.get(id);
    if (!map.has(id) && source !== undefined && isUsableTranslation(source, item.text)) map.set(id, item.text);
  }
  return map;
}
