import { HL } from "../data/constants";
import type { Annotation as SharedAnnotation, AnnotationTargetType, CreateAnnotationRequest } from "@prepdeck/shared";
import type {
  Annotation, AnnotationSeed, AnnotationStyle, AnnotationTarget, MdBlock, MdInlineRange,
  ParsedMarkdown, Question, TextSegment
} from "../types";

/** Frontend annotations collapse target+option-id into one string union; the
 * backend (and D1 schema) keeps them as separate `targetType`/`targetRef`
 * columns (docs/requirements/data-model-and-import-format.md's `annotations` table). These convert between the two. */
export function targetToBackend(target: AnnotationTarget): { targetType: AnnotationTargetType; targetRef: string | null } {
  if (target === "stem") return { targetType: "stem", targetRef: null };
  if (target === "ai") return { targetType: "ai_explanation", targetRef: null };
  return { targetType: "option", targetRef: target.slice(4) };
}

export function targetFromBackend(targetType: AnnotationTargetType, targetRef: string | null): AnnotationTarget {
  if (targetType === "option") return `opt:${targetRef ?? ""}`;
  if (targetType === "ai_explanation") return "ai";
  return "stem";
}

export function fromSharedAnnotation(a: SharedAnnotation): Annotation {
  return {
    id: a.id,
    qid: a.questionId,
    target: targetFromBackend(a.targetType, a.targetRef),
    start: a.rangeStart,
    end: a.rangeEnd,
    style: a.style as AnnotationStyle,
    note: a.note ?? ""
  };
}

export function toCreateAnnotationRequest(
  target: AnnotationTarget,
  start: number,
  end: number,
  style: AnnotationStyle,
  note: string
): CreateAnnotationRequest {
  const { targetType, targetRef } = targetToBackend(target);
  return { targetType, targetRef, rangeStart: start, rangeEnd: end, style, note: note || null };
}

function sourceFor(qid: string, target: AnnotationTarget, catalogBy: Record<string, Question>): string {
  const q = catalogBy[qid];
  if (!q) return "";
  if (target === "stem") return q.stem;
  if (target === "ai") return ""; // AI text is loaded separately from the catalog question.
  const opt = q.options?.find((o) => `opt:${o.id}` === target);
  return opt ? opt.text : "";
}

/** Resolves seeded quotes to character offsets against the current question text. */
export function seedAnnotations(list: AnnotationSeed[], catalogBy: Record<string, Question>): Annotation[] {
  return list
    .map((a) => {
      const src = sourceFor(a.qid, a.target, catalogBy);
      const i = src.indexOf(a.quote);
      return {
        id: a.id, qid: a.qid, target: a.target, style: a.style, note: a.note,
        start: i < 0 ? 0 : i, end: i < 0 ? 0 : i + a.quote.length
      };
    })
    .filter((a) => a.end > a.start);
}

/** Splits `text` into styled segments based on annotations that overlap it. */
export function segsFor(
  text: string,
  annotations: Annotation[],
  qid: string,
  target: AnnotationTarget,
  show: boolean
): TextSegment[] {
  if (!show) {
    return [{ key: "0", off: 0, text, bg: "transparent", color: "inherit", pad: "0", br: "0", weight: "400", deco: "none", title: "" }];
  }
  const anns = annotations.filter((a) => a.qid === qid && a.target === target);
  if (!anns.length) {
    return [{ key: "0", off: 0, text, bg: "transparent", color: "inherit", pad: "0", br: "0", weight: "400", deco: "none", title: "" }];
  }
  const pts: Record<number, 1> = { 0: 1, [text.length]: 1 };
  anns.forEach((a) => {
    pts[Math.max(0, a.start)] = 1;
    pts[Math.min(text.length, a.end)] = 1;
  });
  const arr = Object.keys(pts).map(Number).sort((x, y) => x - y);
  const out: TextSegment[] = [];
  for (let i = 0; i < arr.length - 1; i++) {
    const s0 = arr[i]!;
    const e0 = arr[i + 1]!;
    const act = anns.filter((a) => a.start <= s0 && a.end >= e0);
    let bg = "transparent", color = "inherit", pad = "0", br = "0", weight = "400", deco = "none", title = "";
    act.forEach((a) => {
      const highlight = HL[a.style];
      if (highlight) { bg = highlight.background; color = highlight.text; pad = "2px 3px"; br = "6px"; }
      if (a.style === "underline") deco = "underline";
      if (a.style === "bold") weight = "700";
      if (a.note) title = a.note;
    });
    out.push({
      key: String(i), off: s0, text: text.slice(s0, e0), bg, color, pad, br, weight, deco, title,
      annotationIds: act.map((a) => a.id),
      endingAnnotationIds: act.filter((a) => Math.min(text.length, a.end) === e0).map((a) => a.id)
    });
  }
  return out;
}

/** Same boundary-splitting algorithm as segsFor, but layers a second range
 * source (markdown inline formatting) on top of annotations, scoped to one
 * block's local text — see mdSegsFor below. */
function mdSegsForBlock(
  blockText: string,
  blockStart: number,
  anns: Annotation[],
  inlineRanges: MdInlineRange[],
  show: boolean
): TextSegment[] {
  const localAnns = show
    ? anns
        .filter((a) => a.end > blockStart && a.start < blockStart + blockText.length)
        .map((a) => ({
          ...a,
          start: Math.max(0, a.start - blockStart),
          end: Math.min(blockText.length, a.end - blockStart),
          endsInBlock: a.end <= blockStart + blockText.length
        }))
    : [];
  const localInline = inlineRanges.map((r) => ({
    ...r,
    start: Math.max(0, r.start - blockStart),
    end: Math.min(blockText.length, r.end - blockStart)
  }));

  if (!localAnns.length && !localInline.length) {
    return [{ key: "0", off: blockStart, text: blockText, bg: "transparent", color: "inherit", pad: "0", br: "0", weight: "400", deco: "none", title: "" }];
  }

  const pts: Record<number, 1> = { 0: 1, [blockText.length]: 1 };
  localAnns.forEach((a) => { pts[a.start] = 1; pts[a.end] = 1; });
  localInline.forEach((r) => { pts[r.start] = 1; pts[r.end] = 1; });
  const arr = Object.keys(pts).map(Number).sort((x, y) => x - y);

  const out: TextSegment[] = [];
  for (let i = 0; i < arr.length - 1; i++) {
    const s0 = arr[i]!;
    const e0 = arr[i + 1]!;
    let bg = "transparent", color = "inherit", pad = "0", br = "0", weight = "400", deco = "none", title = "", italic = false, code = false;
    const activeAnns = localAnns.filter((a) => a.start <= s0 && a.end >= e0);
    activeAnns.forEach((a) => {
      const highlight = HL[a.style];
      if (highlight) { bg = highlight.background; color = highlight.text; pad = "2px 3px"; br = "6px"; }
      if (a.style === "underline") deco = "underline";
      if (a.style === "bold") weight = "700";
      if (a.note) title = a.note;
    });
    localInline.filter((r) => r.start <= s0 && r.end >= e0).forEach((r) => {
      if (r.kind === "bold") weight = "700";
      if (r.kind === "italic") italic = true;
      if (r.kind === "code") code = true;
    });
    out.push({
      key: String(i), off: blockStart + s0, text: blockText.slice(s0, e0), bg, color, pad, br, weight, deco, title, italic, code,
      annotationIds: activeAnns.map((a) => a.id),
      endingAnnotationIds: activeAnns.filter((a) => a.endsInBlock && a.end === e0).map((a) => a.id)
    });
  }
  return out;
}

/** Markdown AI explanations (docs/requirements/ai-explanations.md), addressed by the
 * same character-offset annotation model as segsFor (docs/requirements/review-notes-and-annotations.md, FR-8.1) —
 * see lib/markdown.ts for why the parser hands back plainText + ranges
 * rather than an AST/HTML string. Returns one segment array per block, for
 * the caller (MarkdownHighlightedText) to wrap in the right block element. */
export function mdSegsFor(
  parsed: ParsedMarkdown,
  annotations: Annotation[],
  qid: string,
  target: AnnotationTarget,
  show: boolean
): { block: MdBlock; segs: TextSegment[] }[] {
  const offsets = parsed.sourceOffsets;
  const lowerBound = (value: number) => {
    let low = 0, high = offsets!.length;
    while (low < high) { const mid = (low + high) >>> 1; if (offsets![mid]! < value) low = mid + 1; else high = mid; }
    return low;
  };
  const anns = annotations.filter((a) => a.qid === qid && a.target === target)
    .map(a => offsets ? { ...a, start: lowerBound(a.start), end: lowerBound(a.end) } : a);
  return parsed.blocks.map((block) => {
    const blockText = parsed.plainText.slice(block.start, block.end);
    const inlineHere = parsed.inline.filter((r) => r.start < block.end && r.end > block.start);
    let segs = mdSegsForBlock(blockText, block.start, anns, inlineHere, show);
    if (offsets) segs = segs.flatMap(seg => {
      const pieces: TextSegment[] = [];
      let start = 0;
      for (let i = 1; i <= seg.text.length; i++) {
        if (i < seg.text.length && offsets[seg.off + i] === offsets[seg.off + i - 1]! + 1) continue;
        pieces.push({ ...seg, key: `${seg.key}-${start}`, off: offsets[seg.off + start]!, text: seg.text.slice(start, i), endingAnnotationIds: i === seg.text.length ? seg.endingAnnotationIds : [] });
        start = i;
      }
      return pieces;
    });
    return { block, segs };
  });
}
