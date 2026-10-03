import type { Editor } from "@tiptap/react";
import { CodeSnippet02, Dataflow03, Dotpoints01, Heading01, Heading02, Image01, Minus, Table } from "@untitledui/icons";
import type { ReactNode } from "react";

export const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

// Two glyphs Untitled UI does not ship, drawn in its 24px, 2px-stroke style.
const glyph = (d: string) => (props: { className?: string }) => (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={props.className}><path d={d} /></svg>
);
export const NumberedListIcon = glyph("M10 6h10 M10 12h10 M10 18h10 M4 4h1v4 M4 8h2 M4 14.5a1.5 1.5 0 0 1 2.6 1L4 19h3");
export const QuoteIcon = glyph("M4 11h5v7H4z M4 11c0-3 1-5 4-6 M14 11h5v7h-5z M14 11c0-3 1-5 4-6");

export interface BlockCommand {
  id: string;
  title: string;
  hint: string;
  kbd?: string;
  keywords: string;
  icon: ReactNode;
  insert?: boolean;
  run: (editor: Editor, context: { onImage: () => void }) => void;
}

const tile = (icon: ReactNode) => <span className="kp-mi-tile" aria-hidden="true">{icon}</span>;

// The blocks offered by both the toolbar's Insert menu (insert: true) and the
// slash menu. Hints carry the Markdown shortcut, so each menu teaches it.
export const BLOCK_COMMANDS: BlockCommand[] = [
  { id: "h1", title: "Heading 1", hint: "Large section heading", kbd: "#", keywords: "title h1", icon: tile(<Heading01 size={16} />),
    run: editor => editor.chain().focus().setHeading({ level: 1 }).run() },
  { id: "h2", title: "Heading 2", hint: "Medium section heading", kbd: "##", keywords: "subtitle h2", icon: tile(<Heading02 size={16} />),
    run: editor => editor.chain().focus().setHeading({ level: 2 }).run() },
  { id: "h3", title: "Heading 3", hint: "Small section heading", kbd: "###", keywords: "h3", icon: tile(<Heading02 size={16} />),
    run: editor => editor.chain().focus().setHeading({ level: 3 }).run() },
  { id: "bullets", title: "Bulleted list", hint: "A simple list", kbd: "-", keywords: "unordered bullet ul", icon: tile(<Dotpoints01 size={16} />),
    run: editor => editor.chain().focus().toggleBulletList().run() },
  { id: "numbers", title: "Numbered list", hint: "Steps in order", kbd: "1.", keywords: "ordered ol steps", icon: tile(<NumberedListIcon />),
    run: editor => editor.chain().focus().toggleOrderedList().run() },
  { id: "quote", title: "Quote", hint: "Callout or exam tip", kbd: ">", keywords: "blockquote callout tip", icon: tile(<QuoteIcon />),
    run: editor => editor.chain().focus().toggleBlockquote().run() },
  { id: "table", title: "Table", hint: "3 rows, 2 columns, header row", keywords: "grid compare", icon: tile(<Table size={16} />), insert: true,
    run: editor => editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run() },
  { id: "image", title: "Image", hint: "Upload, paste or drop · PNG, JPEG or WebP up to 8 MB", keywords: "picture screenshot photo", icon: tile(<Image01 size={16} />), insert: true,
    run: (_editor, { onImage }) => onImage() },
  { id: "code", title: "Code block", hint: "Monospace, keeps spacing", kbd: "```", keywords: "pre snippet", icon: tile(<CodeSnippet02 size={16} />), insert: true,
    run: editor => editor.chain().focus().toggleCodeBlock().run() },
  { id: "diagram", title: "Diagram", hint: "Mermaid flowchart", keywords: "mermaid flowchart chart", icon: tile(<Dataflow03 size={16} />), insert: true,
    run: editor => editor.chain().focus().insertContent({ type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "flowchart TD\n  A[Start] --> B[End]" }] }).run() },
  { id: "divider", title: "Divider", hint: "A line between sections", kbd: "---", keywords: "rule hr separator line", icon: tile(<Minus size={16} />), insert: true,
    run: editor => editor.chain().focus().setHorizontalRule().run() },
];

export function matchCommands(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return BLOCK_COMMANDS;
  return BLOCK_COMMANDS.filter(command => command.title.toLowerCase().includes(q) || command.keywords.includes(q));
}

// Words for the footer: CJK characters count one each, other scripts by runs.
export function countWords(text: string) {
  return (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^\s\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+/gu) ?? [])
    .filter(word => /[\p{L}\p{N}]/u.test(word)).length;
}
