import { useEffect, useRef, useState, type DragEvent } from "react";
import { Node, selectionToInsertionEnd, type JSONContent } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { NodeSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { AlertTriangle, Bold01, Code01, InfoCircle, Italic01, Link01, Trash01, Upload01, XClose } from "@untitledui/icons";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import { TableKit } from "@tiptap/extension-table";
import MarkdownToolbar, { type EditorMode } from "./MarkdownToolbar";
import PasteMarkdownBanner from "./PasteMarkdownBanner";
import { RawMarkdown, VisualCodeBlock, VisualImage } from "./EditorBlocks";
import { MenuItem } from "./EditorMenu";
import { countWords, matchCommands, MOD, type BlockCommand } from "./editorCommands";
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
  renderHTML: ({ node }) => ["div", { "data-kp-upload": node.attrs.id, class: "kp-upload-placeholder", role: "status" }, node.attrs.label],
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

// The "/" menu opens on a paragraph that holds nothing but a slash and a short
// query, with the caret at its end. Anything else is ordinary text.
function slashQuery(editor: Editor | null): { query: string; from: number; to: number } | null {
  if (!editor || editor.isDestroyed || !editor.view.hasFocus()) return null;
  const { selection } = editor.state;
  if (!selection.empty) return null;
  const { $from } = selection;
  if ($from.parent.type.name !== "paragraph") return null;
  const text = $from.parent.textContent;
  if ($from.parentOffset !== $from.parent.content.size || $from.parent.content.size !== text.length) return null;
  const match = /^\/([\p{L}\p{N} ]{0,24})$/u.exec(text);
  return match ? { query: match[1]!, from: $from.start(), to: $from.pos } : null;
}

export default function MarkdownEditor({ value, onChange, onUploadImage, onCompositionChange, onDismissUploadError, header }: MarkdownEditorProps) {
  const [mode, setMode] = useState<EditorMode>("visual");
  const [pendingPaste, setPendingPaste] = useState<{ text: string; from: number; to: number; before: JSONContent } | null>(null);
  const [uploadFailure, setUploadFailure] = useState<{ file: File; id: string; message: string } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [link, setLink] = useState<{ href: string; existing: boolean; top: number; left: number } | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [sourceDraft, setSourceDraft] = useState(value);
  const [slashPick, setSlashPick] = useState({ query: "", index: 0 });
  const [slashDismissed, setSlashDismissed] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [, renderSelection] = useState(0);
  const callbacks = useRef({ onChange, onUploadImage, onCompositionChange });
  callbacks.current = { onChange, onUploadImage, onCompositionChange };
  const published = useRef(value);
  const composing = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const uploadActive = useRef(false);
  const pasteJustInserted = useRef(false);
  const uploadRef = useRef<(file: File) => void>(() => {});
  const keyRef = useRef<(event: KeyboardEvent) => boolean>(() => false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
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
    onFocus: () => renderSelection(n => n + 1),
    onBlur: () => renderSelection(n => n + 1),
    editorProps: {
      attributes: { "aria-label": "Knowledge point body", role: "textbox", "aria-multiline": "true" },
      handleKeyDown: (_view, event) => keyRef.current(event),
      handleDrop: (view, event) => {
        setDragging(false);
        const file = Array.from(event.dataTransfer?.files ?? []).find(f => f.type.startsWith("image/"));
        if (!file) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (at) editorRef.current?.commands.setTextSelection(at.pos);
        uploadRef.current(file);
        return true;
      },
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
    if (next === mode || uploading || uploadFailure || composing.current) return;
    if (mode === "markdown" && editor) editor.commands.setContent(prepareMarkdown(sourceDraft), { contentType: "markdown", emitUpdate: false });
    if (next === "markdown") setSourceDraft(published.current);
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

  // The link editor is a popover anchored under the selection, not a bar
  // that pushes the document down.
  const openLink = () => {
    if (!editor || modeRef.current !== "visual") return;
    const root = rootRef.current?.getBoundingClientRect();
    const at = editor.view.coordsAtPos(editor.state.selection.from);
    const href = editor.getAttributes("link").href as string | undefined;
    const width = Math.min(380, (root?.width ?? 380) - 8);
    setLink({ href: href ?? "", existing: !!href, top: root ? at.bottom - root.top + 8 : 0,
      left: root ? Math.max(0, Math.min(at.left - root.left - 24, root.width - width)) : 0 });
    setLinkError(null);
  };
  const closeLink = () => { setLink(null); editor?.commands.focus(); };
  const applyLink = () => {
    if (!editor || !link) return;
    const href = link.href.trim();
    if (href && !safeUrl(href)) { setLinkError("Use an https, http, mailto or relative link."); return; }
    const chain = editor.chain().focus().extendMarkRange("link");
    if (!href) chain.unsetLink().run();
    else if (editor.state.selection.empty && !editor.isActive("link")) chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run();
    else chain.setLink({ href }).run();
    setLink(null);
  };

  const slash = mode === "visual" && link === null ? slashQuery(editor) : null;
  const slashOpen = !!slash && slash.from !== slashDismissed;
  const slashItems = slashOpen ? matchCommands(slash.query) : [];
  // The highlighted row belongs to the query it was picked for; a new query
  // starts at the top. A dismissal lasts until the slash itself is gone.
  const slashActive = slash && slashPick.query === slash.query ? Math.min(slashPick.index, Math.max(0, slashItems.length - 1)) : 0;
  if (!slash && slashDismissed !== null) setSlashDismissed(null);
  const setSlashIndex = (index: number) => setSlashPick({ query: slash?.query ?? "", index });
  const runSlash = (command: BlockCommand) => {
    if (!editor || !slash) return;
    editor.chain().focus().deleteRange({ from: slash.from, to: slash.to }).run();
    command.run(editor, { onImage: () => fileInputRef.current?.click() });
  };
  let slashPosition: { top: number; left: number } | null = null;
  if (slashOpen && slashItems.length && editor && rootRef.current) {
    const root = rootRef.current.getBoundingClientRect();
    const at = editor.view.coordsAtPos(slash.from);
    slashPosition = { top: at.bottom - root.top + 6, left: Math.max(0, Math.min(at.left - root.left, root.width - 320)) };
  }

  keyRef.current = event => {
    if (slashOpen && slashItems.length) {
      if (event.key === "ArrowDown") { setSlashIndex((slashActive + 1) % slashItems.length); return true; }
      if (event.key === "ArrowUp") { setSlashIndex((slashActive - 1 + slashItems.length) % slashItems.length); return true; }
      if (event.key === "Enter" || event.key === "Tab") { runSlash(slashItems[slashActive]!); return true; }
    }
    if (slashOpen && event.key === "Escape") { setSlashDismissed(slash.from); return true; }
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") { event.preventDefault(); openLink(); return true; }
    return false;
  };

  const onDragOver = (event: DragEvent) => {
    if (mode === "visual" && !uploading && !uploadFailure && Array.from(event.dataTransfer.types).includes("Files")) setDragging(true);
  };
  const onDragLeave = (event: DragEvent) => {
    if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setDragging(false);
  };

  const plainText = mode === "visual" ? editor?.getText() ?? "" : sourceDraft;
  const words = countWords(plainText);
  const minutes = Math.max(1, Math.round(words / 200));
  const bubbleButton = (label: string, icon: React.ReactNode, active: boolean, action: () => void) => (
    <button type="button" className="kp-bubble-btn" aria-label={label} aria-pressed={active} onMouseDown={e => e.preventDefault()} onClick={action}>{icon}</button>
  );

  return (
    <div ref={rootRef} className="kp-editor" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={() => setDragging(false)}>
      {header && <div className="kp-editor-header">{header}</div>}
      <MarkdownToolbar editor={editor} mode={mode} modeLocked={!!uploading || !!uploadFailure} onModeChange={changeMode}
        onImage={() => fileInputRef.current?.click()} onLink={openLink} />
      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
      {uploadFailure && <div className="kp-upload-failed" role="alert">
        <span className="kp-upload-failed-icon" aria-hidden="true"><AlertTriangle size={18} /></span>
        <span className="kp-upload-failed-text"><strong>Couldn’t add the image.</strong> {uploadFailure.message}</span>
        {uploadFailure.id && <button type="button" className="kp-pill-btn" onClick={() => void upload(uploadFailure.file, uploadFailure.id)}>Retry upload</button>}
        <button type="button" className="kp-icon-btn" aria-label="Dismiss upload" title="Dismiss upload" onClick={dismissUpload}><XClose size={16} /></button>
      </div>}
      <div className="kp-editor-body" data-dragging={dragging || undefined}>
        <div hidden={mode !== "visual"} className="kp-visual">
          <EditorContent editor={editor} />
          {editor?.isEmpty && !editor.view.composing && <p className="kp-placeholder" aria-hidden="true">Start writing. Type <span className="kp-kbd">/</span> for tables, images and diagrams, or paste Markdown.</p>}
        </div>
        {mode === "markdown" && <>
          <p className="kp-source-hint"><InfoCircle size={16} aria-hidden="true" />This is exactly what’s saved. Switch back to Visual any time; nothing is lost.</p>
          <textarea className="kp-source-mode" aria-label="Markdown source" value={sourceDraft} spellCheck={false}
            onCompositionStart={() => { composing.current = true; onCompositionChange?.(true); }}
            onCompositionEnd={e => { composing.current = false; onCompositionChange?.(false); publish(e.currentTarget.value); }}
            onChange={e => { setSourceDraft(e.target.value); if (!composing.current) publish(e.target.value); }} />
        </>}
        {dragging && <div className="kp-drop" aria-hidden="true">
          <Upload01 size={26} />
          <strong>Drop to add the image here</strong>
          <span>PNG, JPEG or WebP, up to 8 MB</span>
        </div>}
      </div>
      {slashPosition && <div className="kp-menu kp-slash" role="listbox" aria-label="Insert a block" style={slashPosition}>
        <div className="kp-menu-label">Blocks</div>
        {slashItems.map((command, index) => (
          <div key={command.id} role="option" aria-selected={index === slashActive} data-active={index === slashActive || undefined}>
            <MenuItem icon={command.icon} title={command.title} hint={command.hint} kbd={command.kbd}
              disabled={command.id === "image" && (!!uploading || !!uploadFailure)} onSelect={() => runSlash(command)} />
          </div>
        ))}
        <p className="kp-menu-foot"><span><span className="kp-kbd">↑</span> <span className="kp-kbd">↓</span> move</span><span><span className="kp-kbd">Enter</span> insert</span><span><span className="kp-kbd">Esc</span> keep as text</span></p>
      </div>}
      {link !== null && <div className="kp-popover" role="group" aria-label="Edit link" style={{ top: link.top, left: link.left }}>
        <label className="kp-field-label" htmlFor="kp-link-url">Link URL</label>
        <input id="kp-link-url" className="kp-input" autoFocus value={link.href} aria-invalid={!!linkError} placeholder="https://"
          onChange={e => { setLink({ ...link, href: e.target.value }); setLinkError(null); }}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); applyLink(); } else if (e.key === "Escape") { e.preventDefault(); closeLink(); } }} />
        <span className={linkError ? "kp-field-error" : "kp-field-hint"} role={linkError ? "alert" : undefined}>{linkError ?? "https, http, mailto or a relative link"}</span>
        <div className="kp-popover-actions">
          {link.existing && <button type="button" className="kp-ghost-btn kp-ghost-danger" onClick={() => { editor?.chain().focus().extendMarkRange("link").unsetLink().run(); setLink(null); }}>Remove link</button>}
          <span className="kp-tb-spacer" />
          <button type="button" className="btn btn-secondary" onClick={closeLink}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={applyLink}>Apply</button>
        </div>
      </div>}
      {editor && <BubbleMenu editor={editor} pluginKey="kpSelectionMenu" className="kp-bubble" role="toolbar" aria-label="Format selection"
        options={{ placement: "top", offset: 8 }}
        shouldShow={({ editor: current, state, from, to }) => modeRef.current === "visual" && from !== to
          && !(state.selection instanceof CellSelection) && !(state.selection instanceof NodeSelection)
          && !current.isActive("codeBlock") && !current.isActive("rawMarkdown")}>
        {bubbleButton("Bold", <Bold01 size={16} />, editor.isActive("bold"), () => editor.chain().focus().toggleBold().run())}
        {bubbleButton("Italic", <Italic01 size={16} />, editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run())}
        {bubbleButton("Inline code", <Code01 size={16} />, editor.isActive("code"), () => editor.chain().focus().toggleCode().run())}
        {bubbleButton(`Link · ${MOD} K`, <Link01 size={16} />, editor.isActive("link"), openLink)}
      </BubbleMenu>}
      {editor && <BubbleMenu editor={editor} pluginKey="kpTableMenu" className="kp-bubble" role="toolbar" aria-label="Table controls"
        options={{ placement: "top-start", offset: 8 }}
        getReferencedVirtualElement={() => {
          const { node } = editor.view.domAtPos(editor.state.selection.from);
          const table = (node instanceof Element ? node : node.parentElement)?.closest(".tableWrapper, table");
          return table ? { getBoundingClientRect: () => table.getBoundingClientRect() } : null;
        }}
        shouldShow={({ editor: current, state }) => modeRef.current === "visual" && current.isActive("table")
          && (state.selection.empty || state.selection instanceof CellSelection)}>
        <button type="button" className="kp-bubble-text" onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().addRowAfter().run()}>Add row</button>
        <button type="button" className="kp-bubble-text" onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().addColumnAfter().run()}>Add column</button>
        <span className="kp-bubble-sep" aria-hidden="true" />
        <button type="button" className="kp-bubble-text" onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().deleteRow().run()}>Remove row</button>
        <button type="button" className="kp-bubble-text" onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().deleteColumn().run()}>Remove column</button>
        <span className="kp-bubble-sep" aria-hidden="true" />
        <button type="button" className="kp-bubble-btn" aria-label="Remove table" title="Remove table" onMouseDown={e => e.preventDefault()} onClick={() => editor.chain().focus().deleteTable().run()}><Trash01 size={16} /></button>
      </BubbleMenu>}
      <div className="kp-editor-foot">
        <span>{words} {words === 1 ? "word" : "words"} · About {minutes} {minutes === 1 ? "minute" : "minutes"} to read</span>
        <span className="kp-editor-foot-hints"><span className="kp-kbd">/</span> blocks <span aria-hidden="true">·</span> <span className="kp-kbd">{MOD} K</span> link <span aria-hidden="true">·</span> Markdown shortcuts work</span>
      </div>
      {pendingPaste && <div className="kp-toast-dock">
        <PasteMarkdownBanner
          wordCount={pendingPaste.text.trim() ? pendingPaste.text.trim().split(/\s+/).length : 0}
          onPasteAsPlainText={pasteAsPlainText} onDismiss={() => setPendingPaste(null)} />
      </div>}
    </div>
  );
}
