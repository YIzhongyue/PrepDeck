import { marked, type Token } from "marked";
import type { JSONContent } from "@tiptap/core";

export const SOURCE_LANGUAGE = "prepdeck-source";

/**
 * Decide whether parsed paste content joins the paragraph it lands in or
 * replaces it with blocks of its own.
 *
 * A single paragraph carries no block structure: it is a run of inline nodes
 * that the markdown parser had to wrap in something. Inserting that wrapper
 * into the middle of an existing paragraph splits it, which is why pasting a
 * word mid-sentence used to produce two paragraphs. Unwrapping it keeps the
 * sentence whole while preserving inline marks, so `**bold**` still arrives
 * bold.
 *
 * Anything else — a heading, a list, a quote, a fenced source block, or several
 * blocks at once — is genuine block structure and is inserted as-is.
 */
export function pasteContent(parsed: JSONContent, fallback = ""): JSONContent[] {
  const blocks = parsed.content ?? [];
  const only = blocks.length === 1 ? blocks[0]! : null;
  const content = only && only.type === "paragraph" ? (only.content ?? []) : blocks;
  // Markdown may parse a nonempty whitespace clipboard as an empty document.
  return content.length || !fallback ? content : plainTextContent(fallback);
}

/**
 * The same distinction for the "Paste as plain text instead" offer.
 *
 * This decides structure only. The caller inserts single-line text as explicit
 * unmarked schema nodes, so it cannot inherit the marks being replaced.
 */
export function plainTextContent(text: string): JSONContent[] {
  const line = (value: string): JSONContent[] => (value ? [{ type: "text", text: value }] : []);
  const lines = text.split("\n");
  if (lines.length === 1) return line(lines[0]!);
  return lines.map((value) => ({ type: "paragraph", content: line(value) }));
}

/** Keep literal paragraph-leading syntax from becoming a block on reopen. */
export function escapeParagraphMarkdown(markdown: string): string {
  return markdown.replace(/^( {0,3})(#{1,6}(?=\s|$)|[+-](?=\s|$)|-{3,}(?=\s*$)|=+(?=\s*$)|\d{1,9}[.)](?=\s|$))/gm,
    (_, indent: string, marker: string) => indent + (/^\d/.test(marker)
      ? `${marker.slice(0, -1)}\\${marker.slice(-1)}` : `\\${marker}`));
}

export function fencedSource(source: string, language = ""): string {
  const longest = Math.max(0, ...Array.from(source.matchAll(/`+/g), (m) => m[0].length));
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${source}\n${fence}`;
}

// `[^label]:` at the start of a line. marked has no core footnote support, so
// both a footnote and its definition arrive as ordinary paragraph text.
const FOOTNOTE_DEFINITION = /^[ \t]*\[\^([^\]\s]+)\]:/gm;
const FOOTNOTE_REFERENCE = /\[\^([^\]\s]+)\]/g;

function unsupported(token: unknown, footnotes: ReadonlySet<string>): boolean {
  if (!token || typeof token !== "object") return false;
  if (Array.isArray(token)) return token.some(item => unsupported(item, footnotes));
  const t = token as Record<string, unknown>;
  if (t.type === "code" || t.type === "codespan") return false;
  if (t.type === "html" || t.type === "def" || t.task === true) return true;
  if (t.type === "link" && Array.isArray(t.tokens) && t.tokens.some(token => token.type === "image")) return true;
  // Footnotes retain their literal source so a parser cannot flatten them into
  // unrelated plain text. Only a reference that actually RESOLVES to a
  // definition in this document counts: an unmatched `[^...]` is already just
  // text in Markdown, and treating every one as a footnote froze ordinary
  // prose — a regex character class like `[^abc]` in a study note is not a
  // footnote. (Reference-style links need no test of their own: they only
  // mean anything alongside a `def`, and prepareMarkdown keeps any document
  // containing one whole. Matching them on shape instead caught `matrix[0][1]`
  // and `config["a"]["b"]`, which are neither.)
  if (footnotes.size && typeof t.raw === "string"
    && Array.from(t.raw.matchAll(FOOTNOTE_REFERENCE)).some(match => footnotes.has(match[1]!))) return true;
  // Math blocks and extension directives, matched per LINE: a display-math
  // block is frequently a lazy continuation of the paragraph above it rather
  // than a token of its own. No ordinary prose opens a line with `$$` or
  // `:::`, so the wider net costs nothing here.
  if (typeof t.raw === "string" && /^\s*(?:\$\$|:::)/m.test(t.raw)) return true;
  if ((t.type === "link" || t.type === "image") && typeof t.href === "string" && !safeUrl(t.href)) return true;
  return Object.entries(t).some(([key, value]) => !["raw", "text", "href"].includes(key) && unsupported(value, footnotes));
}

export function safeUrl(url: string): boolean {
  return /^(?:https?:\/\/|mailto:|\/(?!\/)|#)/i.test(url) && !/[\u0000-\u0020]/.test(url);
}

/** Keep unsupported blocks editable and byte-for-byte intact inside the document. */
export function prepareMarkdown(source: string): string {
  const tokens = marked.lexer(source, { gfm: true });
  // A definition may be referenced far away. Keep reference-style documents as
  // one source block instead of silently severing their reference relationships.
  if (tokens.some((token: Token) => token.type === "def")) return fencedSource(source, SOURCE_LANGUAGE);
  // Footnote labels are document-scoped, so they are resolved once here rather
  // than guessed at per token.
  const footnotes = new Set(Array.from(source.matchAll(FOOTNOTE_DEFINITION), match => match[1]!));
  // A user may already have a code fence named like our internal marker. Wrap
  // that entire fence, so parsing cannot mistake its literal code for source.
  return tokens.map((token: Token) => (token.type === "code" && token.lang === SOURCE_LANGUAGE) || unsupported(token, footnotes)
    ? `${fencedSource(token.raw.replace(/\n+$/, ""), SOURCE_LANGUAGE)}\n\n`
    : token.raw).join("");
}

export function markdownImage(alt: string, src: string, title?: string | null): string {
  // A newline in alt text or a title would end the image's own construct and
  // silently turn the rest of it into body text on the next parse, so both are
  // flattened to spaces before escaping.
  const label = alt.replace(/\s*[\r\n]+\s*/g, " ").replace(/([\\\[\]])/g, "\\$1");
  const destination = src.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
  return `![${label}](${destination}${title ? ` "${title.replace(/\s*[\r\n]+\s*/g, " ").replace(/([\\"])/g, "\\$1")}"` : ""})`;
}

export function imageAltText(token: { text?: string; tokens?: readonly { text?: string; tokens?: readonly unknown[] }[] }): string {
  return token.tokens ? token.tokens.map(t => imageAltText(t as Parameters<typeof imageAltText>[0])).join("") : token.text ?? "";
}
