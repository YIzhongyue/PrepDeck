import type { Editor } from "@tiptap/react";

export type EditorMode = "write" | "preview" | "source";

export default function MarkdownToolbar({ editor, mode, modeLocked, onModeChange, onImage, onLink }: {
  editor: Editor | null; mode: EditorMode; onModeChange: (mode: EditorMode) => void;
  modeLocked?: boolean;
  onImage: () => void; onLink: () => void;
}) {
  const button = (label: string, action: () => void, active?: boolean) => (
    <button type="button" key={label} aria-label={label} aria-pressed={active} disabled={!editor || mode !== "write" || (label === "Image" && modeLocked)}
      onMouseDown={e => e.preventDefault()} onClick={action}>{label}</button>
  );
  return (
    <div className="kp-editor-toolbar" role="toolbar" aria-label="Note formatting">
      <select aria-label="Paragraph style" disabled={!editor || mode !== "write"} value={editor?.isActive("heading") ? editor.getAttributes("heading").level : 0}
        onChange={e => { const level = Number(e.target.value); if (level) editor?.chain().focus().toggleHeading({ level: level as 1 | 2 | 3 }).run(); else editor?.chain().focus().setParagraph().run(); }}>
        <option value="0">Paragraph</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option>
      </select>
      {button("Bold", () => editor?.chain().focus().toggleBold().run(), editor?.isActive("bold"))}
      {button("Italic", () => editor?.chain().focus().toggleItalic().run(), editor?.isActive("italic"))}
      {button("Inline code", () => editor?.chain().focus().toggleCode().run(), editor?.isActive("code"))}
      {button("Bullet list", () => editor?.chain().focus().toggleBulletList().run(), editor?.isActive("bulletList"))}
      {button("Numbered list", () => editor?.chain().focus().toggleOrderedList().run(), editor?.isActive("orderedList"))}
      {button("Quote", () => editor?.chain().focus().toggleBlockquote().run(), editor?.isActive("blockquote"))}
      {button("Code block", () => editor?.chain().focus().toggleCodeBlock().run(), editor?.isActive("codeBlock"))}
      {button("Table", () => editor?.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run())}
      {button("Image", onImage)}
      {button("Mermaid", () => editor?.chain().focus().insertContent({ type: "codeBlock", attrs: { language: "mermaid" }, content: [{ type: "text", text: "flowchart TD\n  A[Start] --> B[End]" }] }).run())}
      {button("Link", onLink, editor?.isActive("link"))}
      {button("Undo", () => editor?.chain().focus().undo().run())}
      {button("Redo", () => editor?.chain().focus().redo().run())}
      <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
        {(["write", "preview", "source"] as const).map(m => <button type="button" key={m} disabled={modeLocked && mode !== m} aria-pressed={mode === m} onClick={() => onModeChange(m)}>{m === "write" ? "Write" : m === "preview" ? "Preview" : "Markdown source"}</button>)}
      </span>
    </div>
  );
}
