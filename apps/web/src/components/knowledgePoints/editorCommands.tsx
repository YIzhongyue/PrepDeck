import type { Editor } from "@tiptap/react";
import { CodeSnippet02, Dataflow03, Dotpoints01, Heading01, Heading02, Image01, Minus, Table } from "@untitledui/icons";
import type { ReactNode } from "react";
import { t } from "../../i18n/runtime";
import en from "../../i18n/messages/en";

export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

// Two glyphs Untitled UI does not ship, drawn in its 24px, 2px-stroke style.
const glyph = (d: string) => (props: { className?: string }) => (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={props.className}><path d={d} /></svg>
);
export const NumberedListIcon = glyph("M10 6h10 M10 12h10 M10 18h10 M4 4h1v4 M4 8h2 M4 14.5a1.5 1.5 0 0 1 2.6 1L4 19h3");
export const QuoteIcon = glyph("M4 11h5v7H4z M4 11c0-3 1-5 4-6 M14 11h5v7h-5z M14 11c0-3 1-5 4-6");

export type BlockId = "h1" | "h2" | "h3" | "bullets" | "numbers" | "quote" | "table" | "image" | "code" | "diagram" | "divider";

export interface BlockCommand {
  id: BlockId;
  /** Read in the interface language each time it is shown (`kp.blocks`). */
  readonly title: string;
  readonly hint: string;
  kbd?: string;
  keywords: string;
  icon: ReactNode;
  insert?: boolean;
  run: (editor: Editor, context: { onImage: () => void }) => void;
}

const tile = (icon: ReactNode) => <span className="kp-mi-tile" aria-hidden="true">{icon}</span>;

function block(command: Omit<BlockCommand, "title" | "hint">): BlockCommand {
  return {
    ...command,
    get title() { return t(`kp.blocks.${command.id}.title`); },
    get hint() { return t(`kp.blocks.${command.id}.hint`); },
  };
}

// The blocks offered by both the toolbar's Insert menu (insert: true) and the
// slash menu. Hints carry the Markdown shortcut, so each menu teaches it.
export const BLOCK_COMMANDS: BlockCommand[] = [
  block({ id: "h1", kbd: "#", keywords: "title h1", icon: tile(<Heading01 size={16} />),
    run: editor => editor.chain().focus().setHeading({ level: 1 }).run() }),
  block({ id: "h2", kbd: "##", keywords: "subtitle h2", icon: tile(<Heading02 size={16} />),
    run: editor => editor.chain().focus().setHeading({ level: 2 }).run() }),
  block({ id: "h3", kbd: "###", keywords: "h3", icon: tile(<Heading02 size={16} />),
    run: editor => editor.chain().focus().setHeading({ level: 3 }).run() }),
  block({ id: "bullets", kbd: "-", keywords: "unordered bullet ul", icon: tile(<Dotpoints01 size={16} />),
    run: editor => editor.chain().focus().toggleBulletList().run() }),
  block({ id: "numbers", kbd: "1.", keywords: "ordered ol steps", icon: tile(<NumberedListIcon />),
    run: editor => editor.chain().focus().toggleOrderedList().run() }),
  block({ id: "quote", kbd: ">", keywords: "blockquote callout tip", icon: tile(<QuoteIcon />),
    run: editor => editor.chain().focus().toggleBlockquote().run() }),
  block({ id: "table", keywords: "grid compare", icon: tile(<Table size={16} />), insert: true,
    run: editor => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run() }),
  block({ id: "image", keywords: "picture screenshot photo", icon: tile(<Image01 size={16} />), insert: true,
    run: (_editor, { onImage }) => onImage() }),
  block({ id: "code", kbd: "```", keywords: "pre snippet", icon: tile(<CodeSnippet02 size={16} />), insert: true,
    run: editor => editor.chain().focus().toggleCodeBlock().run() }),
  block({ id: "diagram", keywords: "mermaid flowchart chart", icon: tile(<Dataflow03 size={16} />), insert: true,
    run: editor => editor.chain().focus().insertContent({ type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "flowchart TD\n  A[Start] --> B[End]" }] }).run() }),
  block({ id: "divider", kbd: "---", keywords: "rule hr separator line", icon: tile(<Minus size={16} />), insert: true,
    run: editor => editor.chain().focus().setHorizontalRule().run() }),
];

export function matchCommands(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCK_COMMANDS;
  // The English name matches in every language, so "/table" always works.
  return BLOCK_COMMANDS.filter(command => command.title.toLowerCase().includes(q)
    || en.kp.blocks[command.id].title.toLowerCase().includes(q) || command.keywords.includes(q));
}

// Words for the footer: CJK characters count one each, other scripts by runs.
export function countWords(text: string) {
  return (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? [])
    .filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}
