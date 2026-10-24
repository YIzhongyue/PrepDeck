import { applyEdits, format, type Edit } from "jsonc-parser";
import { t } from "../i18n/runtime";

export interface JsonSelection {
  start: number;
  end: number;
  direction: "forward" | "backward" | "none";
}

// Offsets are UTF-16, like textarea selections and jsonc-parser edits. At an
// insertion, a selection starts after new whitespace and ends before it; a
// collapsed caret follows the next token. Positions inside replaced whitespace
// stay within the replacement rather than jumping into a different token.
function mapPosition(position: number, edits: Edit[], right: boolean): number {
  let delta = 0;
  for (const edit of edits) {
    if (position < edit.offset) break;
    if (!edit.length && position === edit.offset && !right) break;
    if (position < edit.offset + edit.length) return edit.offset + delta + Math.min(position - edit.offset, edit.content.length);
    delta += edit.content.length - edit.length;
  }
  return position + delta;
}

export function formatJsonSource(text: string, selection: JsonSelection) {
  // Validate syntax only. Never use the decoded value: duplicate properties,
  // large/exponent numbers and original escapes must survive verbatim.
  try { JSON.parse(text); } catch { return undefined; }
  const edits = format(text, undefined, { tabSize: 2, insertSpaces: true, keepLines: false })
    .sort((a, b) => a.offset - b.offset || a.length - b.length);
  // jsonc-parser formats token gaps. This additional check rejects non-whitespace
  // replacements; raw-token regression tests also cover whitespace in strings.
  const whitespace = /^[\t\r\n ]*$/;
  if (edits.some(edit => !whitespace.test(text.slice(edit.offset, edit.offset + edit.length)) || !whitespace.test(edit.content))) {
    throw new Error(t("authoring.json.formatChanges"));
  }
  return {
    text: applyEdits(text, edits),
    selection: {
      start: mapPosition(selection.start, edits, true),
      end: mapPosition(selection.end, edits, selection.start === selection.end),
      direction: selection.direction
    }
  };
}
