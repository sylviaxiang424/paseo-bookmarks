export type MarkdownImage = { source: string; alt: string; key: string };
// A source fingerprint avoids storing signed image URLs or base64 image data.
// Occurrence distinguishes repeated uses of the same picture in one message.
export function imageKey(source: string, occurrence: number): string {
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `${(hash >>> 0).toString(36)}:${occurrence}`;
}
function parseImages(text: string) {
  const images: MarkdownImage[] = [], counts = new Map<string, number>();
  // Ignore code examples; they do not create rendered images.
  // Keep offsets so removing real image markup leaves code examples untouched.
  const source = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`/g, match => " ".repeat(match.length));
  let remainder = "", end = 0;
  const references = new Map<string, string>();
  for (const match of source.matchAll(/^\s{0,3}\[([^\]]+)\]:\s*<?([^\s>]+)>?/gm)) references.set(match[1].toLowerCase(), match[2]);
  const pattern = /!\[((?:\\.|[^\]\\])*)\](?:\(\s*(?:<([^>]+)>|((?:\\.|[^\s()\\]|\([^()]*\))+))(?:\s+["'][^\n]*?["'])?\s*\)|\[([^\]]*)\])/g;
  for (const match of source.matchAll(pattern)) {
    const uri = (match[2] ?? match[3] ?? references.get((match[4] || match[1]).toLowerCase()))?.replace(/\\([\\()\[\] ])/g, "$1");
    if (!uri) continue;
    const occurrence = counts.get(uri) ?? 0; counts.set(uri, occurrence + 1);
    images.push({ source: uri, alt: match[1].replace(/\\(.)/g, "$1"), key: imageKey(uri, occurrence) });
    remainder += text.slice(end, match.index); end = match.index! + match[0].length;
  }
  return { images, remainder: remainder + text.slice(end) };
}
export function markdownImages(text: string): MarkdownImage[] {
  return parseImages(text).images;
}
export function isImageOnlyMessage(text: string): boolean {
  const { images, remainder } = parseImages(text);
  return images.length > 0 && !remainder
    .replace(/^[ \t]{0,3}\[[^\]]+\]:[^\r\n]*(?:\r?\n|$)/gm, "")
    .replace(/^[ \t]{0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})\r?$/gm, "")
    .trim();
}

type Detail = Record<string, unknown>;
export function toolSummary(name: string, detail: Detail): string {
  const text = (value: unknown) => typeof value === "string" ? value : "";
  const heading = text(detail.command) || text(detail.label) || text(detail.filePath) || text(detail.query) || text(detail.url) || name;
  const result = text(detail.output) || text(detail.content) || text(detail.result) || text(detail.text) || text(detail.log) || text(detail.unifiedDiff) || text(detail.newString);
  // Unknown tools can return structured JSON; keep a bounded readable excerpt.
  let extra = result;
  if (!extra && detail.type === "unknown" && detail.output !== undefined) {
    try { extra = JSON.stringify(detail.output); } catch { /* Preserve the tool name. */ }
  }
  return `${heading}\n${extra}`.replace(/\s+/g, " ").trim().slice(0, 800) || name;
}
