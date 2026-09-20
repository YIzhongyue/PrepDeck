import { useEffect, useRef, useState } from "react";
import { Node, selectionToInsertionEnd, type JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import MarkdownToolbar, { type EditorMode } from "./MarkdownToolbar";
import MarkdownPreview from "./MarkdownPreview";
import PasteMarkdownBanner from "./PasteMarkdownBanner";
import { RawMarkdown, VisualCodeBlock, VisualImage } from "./EditorBlocks";
import { escapeParagraphMarkdown, pasteContent, plainTextContent, prepareMarkdown, safeUrl } from "./editorMarkdown";
import "./MarkdownEditor.css";

export interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  onUploadImage: (file: File | Blob) => Promise<string>;
  onCompositionChange?: (composing: boolean) => void;
  onDismissUploadError?: () => void;
  header?: React.ReactNode;
}

const UploadPlaceholder = Node.create({
  name: "uploadPlaceholder", group: "block", atom: true,
  addAttributes: () => ({ id: { default: null }, label: { default: "Uploading image…" } }),
  parseHTML: () => [{ tag: "div[data-kp-upload]" }],
  renderHTML: ({ node }) => ["div", { "data-kp-upload": node.attrs.id, class: "kp-editor-message", role: "status" }, node.attrs.label],
  renderMarkdown: () => "",
});

const EditorStarterKit = StarterKit.extend({
  addExtensions() {
    return this.parent!().map(extension => extension.name !== "paragraph" ? extension : extension.extend({
      renderMarkdown(node, helpers, context) {
        // The upstream renderer escapes inline delimiters, but literal block
        // markers must also stay ordinary paragraph text after a reload.
        return escapeParagraphMarkdown(extension.config.renderMarkdown!(node, helpers, context));
      },
    }));
  },
});

export default function MarkdownEditor({ value, onChange, onUploadImage, onCompositionChange, onDismissUploadError, header }: MarkdownEditorProps) {
  const [mode, setMode] = useState<EditorMode>("write");
  const [pendingPaste, setPendingPaste] = useState<{ text: string; from: number; to: number; before: JSONContent } | null>(null);
  const [uploadFailure, setUploadFailure] = useState<{ file: File; id: string; message: string } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [link, setLink] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sourceDraft, setSourceDraft] = useState(value);
  const [, renderSelection] = useState(0);
  const callbacks = useRef({ onChange, onUploadImage, onCompositionChange });
  callbacks.current = { onChange, onUploadImage, onCompositionChange };
  const published = useRef(value);
  const composing = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadActive = useRef(false);
  const pasteJustInserted = useRef(false);
  const uploadRef = useRef<(file: File) => void>(() => {});
  const publish = (markdown: string) => { published.current = markdown; callbacks.current.onChange(markdown); };

  const editor = useEditor({
    extensions: [EditorStarterKit.configure({ codeBlock: false, link: { openOnClick: false, autolink: false }, underline: false }),
      Markdown, TableKit.configure({ table: { resizable: false, renderWrapper: true } }), RawMarkdown, VisualCodeBlock, VisualImage, UploadPlaceholder],
    content: prepareMarkdown(value), contentType: "markdown", immediatelyRender: false,
    onUpdate: ({ editor: current }) => {
      // The offer's range belongs to the document as it was when the paste
      // landed, so any LATER edit invalidates those offsets — withdraw it
      // rather than reapply them over newly typed text. The paste's own
      // insertion is the one update that must not withdraw it.
      if (pasteJustInserted.current) pasteJustInserted.current = false;
      else setPendingPaste(null);
      if (!composing.current && !current.view.composing) publish(current.getMarkdown());
    },
    onSelectionUpdate: () => renderSelection(n => n + 1),
    editorProps: {
      attributes: { "aria-label": "Knowledge point body", role: "textbox", "aria-multiline": "true" },
      handleDOMEvents: {
        compositionstart: () => { composing.current = true; callbacks.current.onCompositionChange?.(true); return false; },
        compositionend: view => {
          // ProseMirror applies the final composition transaction after this event.
          window.setTimeout(() => {
            if (view.isDestroyed) return;
            composing.current = false; callbacks.current.onCompositionChange?.(false); publish(editorRef.current!.getMarkdown());
          }, 0);
          return false;
        },
      },
      handlePaste: (view, event) => {
        const file = Array.from(event.clipboardData?.files ?? []).find(f => f.type.startsWith("image/"));
        if (file) { event.preventDefault(); uploadRef.current(file); return true; }
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (!text || view.state.selection.$from.parent.type.spec.code) return false;
        event.preventDefault();
        // Paste NOW, and offer the alternative afterwards. Holding the content
        // back until the reader chose made every paste — a word, a URL, a
        // number — cost a decision, and the offer was withdrawn by the next
        // edit or a mode change, so pasting and continuing to type (the
        // natural response to nothing appearing) silently dropped it.
        const editor = editorRef.current;
        if (!editor) return false;
        const { from, to } = view.state.selection;
        const range = { from, to };
        const before = editor.getJSON();
        // Parse first, insert second. Handing the markdown straight to
        // insertContentAt made EVERY paste a block insertion — "NEW" lexes to a
        // paragraph, and dropping a paragraph into the middle of one splits it,
        // so pasting a word mid-sentence tore the sentence in two. Parsing here
        // lets a paste that carries no block structure of its own go in as the
        // inline content it actually is (pasteContent).
        const prepared = prepareMarkdown(text);
        const parsed = editor.markdown?.parse(prepared);
        pasteJustInserted.current = true;
        try {
          if (parsed) editor.chain().focus().insertContentAt(range, pasteContent(parsed, text)).run();
          else editor.chain().focus().insertContentAt(range, prepared, { contentType: "markdown" }).run();
        } finally {
          // Identical replacements emit no update. Never let their guard hide
          // the next real edit and leave a stale alternative able to erase it.
          pasteJustInserted.current = false;
        }
        setPendingPaste({ text, from, to, before });
        return true;
      },
    },
  });
  const editorRef = useRef(editor);
  editorRef.current = editor;

  useEffect(() => {
    if (!editor || value === published.current || composing.current) return;
    // Only an explicit external load/conflict recovery replaces the document.
    // Autosave acknowledgements do not reset selection or the undo history.
    published.current = value;
    setPendingPaste(null);
    editor.commands.setContent(prepareMarkdown(value), { contentType: "markdown", emitUpdate: false });
    setSourceDraft(value);
  }, [editor, value]);

  const upload = async (file: File, previousId?: string) => {
    if (!editor || uploadActive.current || (uploadFailure && previousId === undefined)) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 8 * 1024 * 1024) {
      setUploadFailure({ file, id: "", message: "Choose a PNG, JPEG or WebP image up to 8 MB." }); return;
    }
    const id = previousId || crypto.randomUUID();
    uploadActive.current = true;
    setUploading(count => count + 1);
    setUploadFailure(null);
    if (!previousId) editor.chain().focus().insertContent({ type: "uploadPlaceholder", attrs: { id } }).createParagraphNear().run();
    try {
      const url = await callbacks.current.onUploadImage(file);
      if (editor.isDestroyed) return;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "uploadPlaceholder" && node.attrs.id === id) {
          editor.chain().insertContentAt({ from: pos, to: pos + node.nodeSize }, { type: "image", attrs: { src: url, alt: "" } }).run();
          return false;
        }
      });
    } catch (error) {
      if (!editor.isDestroyed) setUploadFailure({ file, id, message: error instanceof Error ? error.message : "Upload failed. Your text is retained." });
    } finally {
      uploadActive.current = false;
      setUploading(count => count - 1);
    }
  };
  uploadRef.current = file => { void upload(file); };

  const changeMode = (next: EditorMode) => {
    if (uploading || uploadFailure || composing.current) return;
    if (mode === "source" && editor) editor.commands.setContent(prepareMarkdown(sourceDraft), { contentType: "markdown", emitUpdate: false });
    if (next === "source") setSourceDraft(published.current);
    setPendingPaste(null); setLink(null);
    setMode(next);
  };
  // Replaces what was already pasted with its literal text. Clearing the offer
  // first means onUpdate's own withdrawal is a harmless no-op.
  const pasteAsPlainText = () => {
    if (!pendingPaste || !editor) return;
    const { text, from, to, before } = pendingPaste;
    setPendingPaste(null);
    // A block paste may replace the surrounding paragraph's structure too.
    // Restore it and replace the original selection in one undoable transaction.
    // Subsequent edits and external loads withdraw this snapshot's offer.
    const chain = editor.chain().focus().command(({ tr }) => {
      // Even an immediate click must undo back to the formatted paste.
      closeHistory(tr);
      tr.replaceWith(0, tr.doc.content.size, editor.schema.nodeFromJSON(before).content);
      return true;
    });
    const content = plainTextContent(text);
    if (!text.includes("\n")) {
      chain.command(({ tr }) => {
        const startLen = tr.steps.length;
        tr.replaceWith(from, to, content.map(node => editor.schema.nodeFromJSON(node)));
        // AllSelection can insert a paragraph wrapper. Use the replacement's
        // mapped end and resolve back into its text, not the original offset.
        selectionToInsertionEnd(tr, startLen, -1);
        return true;
      }).run();
    } else chain.insertContentAt({ from, to }, content).run();
  };
  const dismissUpload = () => {
    if (editor && uploadFailure?.id) editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "uploadPlaceholder" && node.attrs.id === uploadFailure.id) { editor.commands.deleteRange({ from: pos, to: pos + node.nodeSize }); return false; }
    });
    setUploadFailure(null); onDismissUploadError?.();
  };

  return (
    <div className="kp-editor">
      <MarkdownToolbar editor={editor} mode={mode} modeLocked={!!uploading || !!uploadFailure} onModeChange={changeMode} onImage={() => fileInputRef.current?.click()} onLink={() => { setLink(editor?.getAttributes("link").href ?? ""); setLinkError(null); }} />
      {mode === "write" && editor?.isActive("table") && <div className="kp-table-tools" aria-label="Table controls">
        <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()}>Add row</button>
        <button type="button" onClick={() => editor.chain().focus().deleteRow().run()}>Remove row</button>
        <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()}>Add column</button>
        <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()}>Remove column</button>
        <button type="button" onClick={() => editor.chain().focus().deleteTable().run()}>Remove table</button>
      </div>}
      {link !== null && <div className="kp-block-controls" role="group" aria-label="Edit link">
        <label>Link URL <input autoFocus value={link} onChange={e => setLink(e.target.value)} /></label>
        <button type="button" onClick={() => { if (link && !safeUrl(link)) { setLinkError("Use an https, http, mailto or relative link."); return; } const chain = editor?.chain().focus().extendMarkRange("link"); if (link) chain?.setLink({ href: link }).run(); else chain?.unsetLink().run(); setLink(null); }}>Apply link</button>
        <button type="button" onClick={() => setLink(null)}>Cancel</button>
        {linkError && <span role="alert">{linkError}</span>}
      </div>}
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
      {header && <div className="kp-editor-header">{header}</div>}
      {pendingPaste && <PasteMarkdownBanner
        wordCount={pendingPaste.text.trim() ? pendingPaste.text.trim().split(/\s+/).length : 0}
        onPasteAsPlainText={pasteAsPlainText} onDismiss={() => setPendingPaste(null)} />}
      {uploadFailure && <div className="kp-editor-message" role="alert">{uploadFailure.message} <button type="button" onClick={() => void upload(uploadFailure.file, uploadFailure.id)}>Retry upload</button> <button type="button" onClick={dismissUpload}>Dismiss upload</button></div>}
      {(uploading > 0 || uploadFailure) && <p className="kp-editor-message">Finish or dismiss this upload before adding another image or changing editor mode.</p>}
      <div className="kp-editor-body">
        <div hidden={mode !== "write"}><EditorContent editor={editor} /></div>
        {mode === "preview" && <MarkdownPreview source={value} />}
        {mode === "source" && <textarea className="kp-source-mode" aria-label="Markdown source" value={sourceDraft}
          onCompositionStart={() => { composing.current = true; onCompositionChange?.(true); }}
          onCompositionEnd={e => { composing.current = false; onCompositionChange?.(false); publish(e.currentTarget.value); }}
          onChange={e => { setSourceDraft(e.target.value); if (!composing.current) publish(e.target.value); }} />}
      </div>
      <p className="kp-editor-message">Type Markdown shortcuts or paste as Markdown. Screenshots: PNG, JPEG or WebP, up to 8 MB.</p>
    </div>
  );
}
