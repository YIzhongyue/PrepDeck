import type { MdBlock, MdBlockType, MdInlineRange, ParsedMarkdown } from "../types";
import { isProseLine, proseLineSeparator } from "./prose";

// Parses a constrained subset of Markdown — headings (#/##/###), bold,
// italic, inline code, fenced code blocks, unordered/ordered lists, and
// horizontal rules — into a flat plain-text string plus block/inline range
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
    plainText += parseInline(text, start, inline, sourceCoordinates ? sourceOffsets : undefined, blockOffset, inputOffsets);
    if (plainText.length > start) blocks.push({ type, start, end: plainText.length });
  };
  const pushRaw = (type: MdBlockType, text: string) => {
    const start = plainText.length;
    plainText += text;
    if (sourceCoordinates) for (let i = 0; i < text.length; i++) sourceOffsets.push(codeOffset + i);
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
        const separator = proseLineSeparator(parseInline(pendingProse.text, 0, []), parseInline(line, 0, []));
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

  return { plainText, blocks, inline, ...(sourceCoordinates ? { sourceOffsets } : {}) };
}

// Strips **bold**/__bold__, *italic*/_italic_ and `code` markers from
// `text`, recording format ranges (offsets into the final plainText, via
// `base` + how far into `text` each match starts) and returning the
// marker-free string. Single-pass and greedy — not spec-correct for
// adversarial/nested markdown, but matches real LLM output reliably.
function parseInline(text: string, base: number, inline: MdInlineRange[], offsets?: number[], sourceBase = 0, inputOffsets?: number[]): string {
  const sourceAt = (index: number) => inputOffsets?.[index] ?? sourceBase + index;
  let out = "";
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === "**" || two === "__") {
      const close = text.indexOf(two, i + 2);
      if (close !== -1) {
        const inner = text.slice(i + 2, close);
        const start = base + out.length;
        out += inner;
        if (offsets) for (let n = 0; n < inner.length; n++) offsets.push(sourceAt(i + 2 + n));
        inline.push({ start, end: start + inner.length, kind: "bold" });
        i = close + 2;
        continue;
      }
    }
    const one = text[i]!;
    if ((one === "*" || one === "_") && text[i + 1] !== " " && text[i + 1] !== one) {
      const close = text.indexOf(one, i + 1);
      if (close !== -1 && close > i + 1) {
        const inner = text.slice(i + 1, close);
        const start = base + out.length;
        out += inner;
        if (offsets) for (let n = 0; n < inner.length; n++) offsets.push(sourceAt(i + 1 + n));
        inline.push({ start, end: start + inner.length, kind: "italic" });
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
    out += one;
    offsets?.push(sourceAt(i));
    i++;
  }
  return out;
}
