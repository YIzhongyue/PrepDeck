// implementation — denormalized list-row fields recomputed server-side on every
// content autosave, so GET /api/knowledge-points stays a flat SELECT rather
// than parsing Markdown per row. Deliberately a pragmatic strip, not a full
// Markdown parser — mirrors the existing hand-rolled apps/web/src/lib/markdown.ts,
// which only covers what this app actually needs to render, not every case.

const EXCERPT_MAX_LENGTH = 220;

const MERMAID_FENCE = /```[ \t]*mermaid\b[^\n]*\n[\s\S]*?```/gi;
const ANY_FENCE = /```[^\n]*\n[\s\S]*?```/g;

export function countMermaidFences(bodyMarkdown: string): number {
  const matches = bodyMarkdown.match(MERMAID_FENCE);
  return matches ? matches.length : 0;
}

export function stripMarkdownToExcerpt(bodyMarkdown: string, maxLength = EXCERPT_MAX_LENGTH): string {
  let text = bodyMarkdown
    // Fenced code blocks (incl. mermaid) carry no useful excerpt text.
    .replace(ANY_FENCE, " ")
    // Images: drop entirely (alt text isn't reliably meaningful prose).
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    // Links: keep the visible text, drop the URL.
    .replace(/\[([^\]]*)]\([^)]*\)/g, "$1")
    // implementation — raw HTML blocks are now preserved (not dropped) in the
    // rendered preview (see lib/preserveUnsupportedMarkdown.ts on the web
    // side), so a note's excerpt should strip HTML tags rather than showing
    // them as literal text in the list.
    .replace(/<[^>]+>/g, " ");

  const lines = text.split("\n").map((line) => {
    let l = line;
    l = l.replace(/^\s{0,3}#{1,6}\s+/, ""); // headings
    l = l.replace(/^\s{0,3}>\s?/, ""); // blockquotes
    l = l.replace(/^\s*[-*+]\s+/, ""); // bullet lists
    l = l.replace(/^\s*\d+\.\s+/, ""); // numbered lists
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes("|")) return ""; // table separator rows
    l = l.replace(/\|/g, " "); // flatten remaining table pipes
    return l;
  });
  text = lines.join(" ");

  text = text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length <= maxLength) return text;
  const truncated = text.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(" ");
  return `${lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated}…`;
}
