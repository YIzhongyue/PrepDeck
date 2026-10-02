import type { MdBlock, MdBlockType, MdInlineRange, ParsedMarkdown } from "../types";
import { isProseLine, proseLineSeparator } from "./prose";

// Parses a constrained subset of Markdown — headings (#/##/###), bold,
// italic, inline code, links ([text](url) and bare http(s) URLs), backslash
// escapes of inline markers, fenced code blocks, unordered/ordered lists, and
// horizontal rules — into a flat
// plain-text string plus block/inline range
// metadata. Not a full CommonMark implementation: this only needs to cover
// what Claude/GPT actually produce for docs/requirements/ai-explanations.md's AI explanations (see
// prompts/explanation.njk), and every one of those constructs showed up in
// real generated output while building this feature.
//
// The output is deliberately (plainText + offset ranges), not an AST or an
// HTML string: that's what lets docs/requirements/review-notes-and-annotations.md's character-offset annotation
// system keep addressing the same text it always has (see
// MarkdownHighlightedText.tsx / lib/annotations.ts's mdSegsFor), instead of
// annotations breaking the moment formatting markers are stripped for display.
export function parseMarkdown(src: string, sourceCoordinates = false, reflowProse = false): ParsedMarkdown {
  const { sourceOffsets, ...parsed } = parseBlocks(src, reflowProse, false);
  if (sourceCoordinates) return { ...parsed, sourceOffsets };
  // Display-coordinate callers (AI explanations) persist annotations as offsets
  // into plainText as the legacy parser produced it: "[label](url)" stayed
  // literal, "\_" kept its backslash, and any "_" pair, even inside
  // identifiers such as new_events, was read as italics. Where today's parse
  // differs, map each character back to that legacy offset so saved marks, and
  // new ones captured through data-off, stay in one coordinate space.
  if (!parsed.inline.some(r => r.kind === "link") && !/[_\\]/.test(src)) return parsed;
  const legacy = parseBlocks(src, reflowProse, true);
  if (legacy.plainText === parsed.plainText) return parsed;
  const legacyAt = new Array<number>(src.length).fill(-1);
  legacy.sourceOffsets.forEach((source, index) => { legacyAt[source] = index; });
  const offsets = new Array<number>(sourceOffsets.length);
  // A character the legacy parser dropped (e.g. "_" it read as italics inside a
  // bare URL) takes the next mapped offset, keeping the map non-decreasing.
  let next = legacy.plainText.length;
  for (let i = offsets.length - 1; i >= 0; i--) {
    const at = legacyAt[sourceOffsets[i]!]!;
    next = offsets[i] = at >= 0 && at <= next ? at : next;
  }
  return { ...parsed, sourceOffsets: offsets };
}

// Always records each plainText character's source offset; parseMarkdown
// decides which coordinate system callers see.
function parseBlocks(src: string, reflowProse: boolean, legacy: boolean): ParsedMarkdown & { sourceOffsets: number[] } {
  // Keep existing AI display-coordinate annotations unchanged. Question callers
  // opt in and retain sourceOffsets, including gaps left by removed layout LFs.
  // Display-math regions remain conservative until they have a typed renderer.
  reflowProse = reflowProse && !/^\s*(?:\$\$|\\\[|\\\]|~~~)/m.test(src);
  const sourceOffsets: number[] = [];
  let lineOffset = 0, blockOffset = 0, codeOffset = 0;
  const lines = src.split("\n");
  let plainText = "";
  const blocks: MdBlock[] = [];
  const inline: MdInlineRange[] = [];

  const pushInlineBlock = (type: MdBlockType, text: string, inputOffsets?: number[]) => {
    const start = plainText.length;
    plainText += parseInline(text, start, inline, sourceOffsets, blockOffset, inputOffsets, legacy);
    if (plainText.length > start) blocks.push({ type, start, end: plainText.length });
  };
  const pushRaw = (type: MdBlockType, text: string) => {
    const start = plainText.length;
    plainText += text;
    for (let i = 0; i < text.length; i++) sourceOffsets.push(codeOffset + i);
    blocks.push({ type, start, end: plainText.length });
  };

  let inCodeFence = false;
  let codeFenceText = "";
  let pendingProse: { text: string; offsets: number[] } | null = null;
  const flushProse = () => {
    if (pendingProse) pushInlineBlock("p", pendingProse.text, pendingProse.offsets);
    pendingProse = null;
  };

  for (const raw of lines) {
    const prose = reflowProse && !inCodeFence && Boolean(raw.trim()) && isProseLine(raw) && !/^(-{3,}|\*{3,}|_{3,})$/.test(raw.trim());
    if (!prose) flushProse();
    blockOffset = lineOffset;
    lineOffset += raw.length + 1;
    if (/^\s*```/.test(raw)) {
      if (inCodeFence) {
        pushRaw("code", codeFenceText);
        inCodeFence = false;
        codeFenceText = "";
      } else {
        inCodeFence = true;
        codeOffset = lineOffset;
        codeFenceText = "";
      }
      continue;
    }
    if (inCodeFence) {
      if (!codeFenceText && !raw) codeOffset = lineOffset;
      codeFenceText += (codeFenceText ? "\n" : "") + raw;
      continue;
    }

    let line = raw.trim();
    blockOffset += raw.length - raw.trimStart().length;
    if (!line) continue; // blank line: paragraph separator only

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blockOffset += line.length - heading[2]!.length;
      const level = heading[1]!.length;
      pushInlineBlock(level === 1 ? "h1" : level === 2 ? "h2" : "h3", heading[2]!);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      blocks.push({ type: "hr", start: plainText.length, end: plainText.length });
      continue;
    }
    const bullet = line.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      blockOffset += line.length - bullet[1]!.length;
      pushInlineBlock("li", bullet[1]!);
      continue;
    }
    const numbered = line.match(/^\d+[.)]\s+(.*)$/);
    if (numbered) {
      blockOffset += line.length - numbered[1]!.length;
      pushInlineBlock("oli", numbered[1]!);
      continue;
    }
    const hardBreak = / {2,}\r?$/.test(raw) || (raw.match(/\\+\r?$/)?.[0].replace(/\r$/, "").length ?? 0) % 2 === 1;
    if (prose && hardBreak && line.endsWith("\\")) line = line.slice(0, -1);
    if (prose) {
      if (pendingProse) {
        const separator = proseLineSeparator(parseInline(pendingProse.text, 0, [], undefined, 0, undefined, legacy), parseInline(line, 0, [], undefined, 0, undefined, legacy));
        pendingProse.text += separator;
        if (separator) pendingProse.offsets.push(src.lastIndexOf("\n", blockOffset - 1));
      } else pendingProse = { text: "", offsets: [] };
      pendingProse.text += line;
      for (let n = 0; n < line.length; n++) pendingProse.offsets.push(blockOffset + n);
      if (hardBreak) flushProse();
    } else pushInlineBlock("p", line);
  }
  flushProse();
  if (inCodeFence && codeFenceText) pushRaw("code", codeFenceText);

  return { plainText, blocks, inline, sourceOffsets };
}

// Strips **bold**/__bold__, *italic*/_italic_, `code` and [link](url) markers from
// `text`, recording format ranges (offsets into the final plainText, via
// `base` + how far into `text` each match starts) and returning the
// marker-free string. Single-pass and greedy — not spec-correct for
// adversarial/nested markdown, but matches real LLM output reliably.
// `legacy` reproduces the parser AI annotations were saved against (see
// parseMarkdown): no links, no escapes, and "_" emphasis anywhere.
function parseInline(text: string, base: number, inline: MdInlineRange[], offsets?: number[], sourceBase = 0, inputOffsets?: number[], legacy = false): string {
  const sourceAt = (index: number) => inputOffsets?.[index] ?? sourceBase + index;
  let out = "";
  // Appends text[from, to) with escapes resolved, as emphasis content.
  const emit = (from: number, to: number) => {
    for (let n = from; n < to; n++) {
      if (!legacy && isEscape(text, n)) n++;
      out += text[n]!;
      offsets?.push(sourceAt(n));
    }
  };
  // The next unescaped `marker` after `from` that can close emphasis.
  const closer = (marker: string, from: number) => {
    for (let close = text.indexOf(marker, from); close !== -1; close = text.indexOf(marker, close + 1)) {
      if (legacy) return close;
      if (isEscaped(text, close)) continue;
      if (marker[0] !== "_" || canCloseUnderscore(text, close, marker.length)) return close;
    }
    return -1;
  };
  let i = 0;
  while (i < text.length) {
    if (!legacy && isEscape(text, i)) {
      out += text[i + 1]!;
      offsets?.push(sourceAt(i + 1));
      i += 2;
      continue;
    }
    const two = text.slice(i, i + 2);
    if ((two === "**" || two === "__") && (two === "**" || legacy || canOpenUnderscore(text, i, 2))) {
      const close = closer(two, i + 2);
      if (close !== -1) {
        const start = base + out.length;
        emit(i + 2, close);
        inline.push({ start, end: base + out.length, kind: "bold" });
        i = close + 2;
        continue;
      }
    }
    const one = text[i]!;
    if ((one === "*" || one === "_") && text[i + 1] !== " " && text[i + 1] !== one
      && (one === "*" || legacy || canOpenUnderscore(text, i, 1))) {
      const close = closer(one, i + 1);
      if (close !== -1 && close > i + 1) {
        const start = base + out.length;
        emit(i + 1, close);
        inline.push({ start, end: base + out.length, kind: "italic" });
        i = close + 1;
        continue;
      }
    }
    if (one === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1) {
        const inner = text.slice(i + 1, close);
        const start = base + out.length;
        out += inner;
        if (offsets) for (let n = 0; n < inner.length; n++) offsets.push(sourceAt(i + 1 + n));
        inline.push({ start, end: start + inner.length, kind: "code" });
        i = close + 1;
        continue;
      }
    }
    if (!legacy && one === "[") {
      const link = /^\[([^\]\n]+)\]\(<?([^\s()<>]+)>?\)/.exec(text.slice(i));
      if (link && SAFE_HREF.test(link[2]!)) {
        const start = base + out.length;
        // One entry per UTF-16 code unit, matching how parseInline indexes text.
        const innerOffsets = Array.from({ length: link[1]!.length }, (_, n) => sourceAt(i + 1 + n));
        out += parseInline(link[1]!, start, inline, offsets, 0, innerOffsets, legacy);
        inline.push({ start, end: base + out.length, kind: "link", href: link[2]! });
        i += link[0].length;
        continue;
      }
    }
    if (!legacy && (one === "h" || one === "H") && !/[A-Za-z0-9]/.test(text[i - 1] ?? "")) {
      const url = bareUrl(text.slice(i));
      if (url) {
        const start = base + out.length;
        out += url;
        if (offsets) for (let n = 0; n < url.length; n++) offsets.push(sourceAt(i + n));
        inline.push({ start, end: start + url.length, kind: "link", href: url });
        i += url.length;
        continue;
      }
    }
    out += one;
    offsets?.push(sourceAt(i));
    i++;
  }
  return out;
}

// Backslash escapes for the inline markers only. Other punctuation keeps its
// backslash, so LaTeX such as \( \{ \[ and paths such as \\server stay as
// written; "\_" also reads the same in LaTeX.
function isEscape(text: string, i: number): boolean {
  return text[i] === "\\" && /[*_`]/.test(text[i + 1] ?? "");
}

// Whether text[i] is the marker half of an escape. "\\" is not an escape
// itself, so a backslash always escapes the marker that follows it.
function isEscaped(text: string, i: number): boolean {
  return text[i - 1] === "\\";
}

// CommonMark's flanking rules for "_" and "__" (spec §6.2): a run inside a
// word, as in new_events, event_id or AWS_S3_BUCKET, neither opens nor closes
// emphasis. "*" stays usable inside words, as in CommonMark. "_" counts as a
// word character so the second underscore of a run (foo__bar) cannot open.
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const SPACE = /\s/u;
function canOpenUnderscore(text: string, i: number, length: number): boolean {
  const before = text[i - 1] ?? " ", after = text[i + length] ?? " ";
  return !SPACE.test(after) && !WORD_CHAR.test(before);
}
function canCloseUnderscore(text: string, i: number, length: number): boolean {
  const before = text[i - 1] ?? " ", after = text[i + length] ?? " ";
  return !SPACE.test(before) && !WORD_CHAR.test(after);
}

// Only web and mail links become anchors; anything else (javascript:, data:,
// relative paths) stays literal text.
const SAFE_HREF = /^(https?:\/\/|mailto:)/i;

// A bare http(s) URL, limited to ASCII URL characters so trailing CJK prose
// (e.g. "…/tune-file-size。") isn't swallowed, minus trailing sentence
// punctuation and any closing paren that has no opener inside the URL.
function bareUrl(text: string): string | null {
  let url = /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+/i.exec(text)?.[0];
  if (!url) return null;
  for (;;) {
    const last = url.at(-1)!;
    if (/[.,;:!?'"*_]/.test(last)) url = url.slice(0, -1);
    else if (last === ")" && (url.match(/\(/g)?.length ?? 0) < (url.match(/\)/g)?.length ?? 0)) url = url.slice(0, -1);
    else break;
  }
  return /^https?:\/\/./i.test(url) ? url : null;
}
