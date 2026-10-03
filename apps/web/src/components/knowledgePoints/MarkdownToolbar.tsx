import type { Editor } from "@tiptap/react";
import { Bold01, ChevronDown, Code01, Dotpoints01, FlipBackward, FlipForward, Italic01, Link01, Plus } from "@untitledui/icons";
import type { ReactNode } from "react";
import { Dropdown, MenuItem } from "./EditorMenu";
import { BLOCK_COMMANDS, MOD, NumberedListIcon, QuoteIcon } from "./editorCommands";

export type EditorMode = "visual" | "markdown";

const STYLES = [
  { level: 0, label: "Paragraph", kbd: `${MOD} Alt 0` },
  { level: 1, label: "Heading 1", kbd: "#" },
  { level: 2, label: "Heading 2", kbd: "##" },
  { level: 3, label: "Heading 3", kbd: "###" },
] as const;

export default function MarkdownToolbar({ editor, mode, modeLocked, onModeChange, onImage, onLink }: {
  editor: Editor | null; mode: EditorMode; onModeChange: (mode: EditorMode) => void;
  modeLocked?: boolean;
  onImage: () => void; onLink: () => void;
}) {
  const off = !editor || mode !== "visual";
  const level = editor?.isActive("heading") ? Number(editor.getAttributes("heading").level) : 0;
  const current = STYLES.find(style => style.level === level) ?? STYLES[0];
  const button = (label: string, icon: ReactNode, action: () => void, options: { active?: boolean; shortcut?: string; disabled?: boolean } = {}) => (
    <button type="button" className="kp-tb-btn" aria-label={label} title={options.shortcut ? `${label} · ${options.shortcut}` : label}
      aria-pressed={options.active === undefined ? undefined : options.active} disabled={off || options.disabled}
      onMouseDown={event => event.preventDefault()} onClick={action}>{icon}</button>
  );
  const lockedTitle = "Finish or dismiss the image upload first";

  return (
    <div className="kp-toolbar" role="toolbar" aria-label="Note formatting">
      <Dropdown label={`Text style: ${current.label}`} menuLabel="Text style" triggerClassName="kp-tb-style" disabled={off} width={260}
        trigger={<><span>{current.label}</span><ChevronDown size={14} aria-hidden="true" /></>}>
        {close => STYLES.map(style => (
          <MenuItem key={style.level} checked={style.level === level} kbd={style.kbd}
            title={<span className={`kp-style-sample kp-style-${style.level}`}>{style.label}</span>}
            onSelect={() => {
              close();
              if (style.level) editor?.chain().focus().setHeading({ level: style.level }).run();
              else editor?.chain().focus().setParagraph().run();
            }} />
        ))}
      </Dropdown>
      <span className="kp-tb-sep" aria-hidden="true" />
      {button("Bold", <Bold01 size={18} />, () => editor?.chain().focus().toggleBold().run(), { active: !!editor?.isActive("bold"), shortcut: `${MOD} B` })}
      {button("Italic", <Italic01 size={18} />, () => editor?.chain().focus().toggleItalic().run(), { active: !!editor?.isActive("italic"), shortcut: `${MOD} I` })}
      {button("Inline code", <Code01 size={18} />, () => editor?.chain().focus().toggleCode().run(), { active: !!editor?.isActive("code"), shortcut: `${MOD} E` })}
      {button("Link", <Link01 size={18} />, onLink, { active: !!editor?.isActive("link"), shortcut: `${MOD} K` })}
      <span className="kp-tb-sep" aria-hidden="true" />
      {button("Bulleted list", <Dotpoints01 size={18} />, () => editor?.chain().focus().toggleBulletList().run(), { active: !!editor?.isActive("bulletList"), shortcut: "- space" })}
      {button("Numbered list", <NumberedListIcon className="kp-ico-18" />, () => editor?.chain().focus().toggleOrderedList().run(), { active: !!editor?.isActive("orderedList"), shortcut: "1. space" })}
      {button("Quote", <QuoteIcon className="kp-ico-18" />, () => editor?.chain().focus().toggleBlockquote().run(), { active: !!editor?.isActive("blockquote"), shortcut: "> space" })}
      <span className="kp-tb-sep" aria-hidden="true" />
      <Dropdown menuLabel="Insert" triggerClassName="kp-tb-insert" disabled={off} width={316}
        trigger={<><Plus size={16} aria-hidden="true" />Insert<ChevronDown size={14} aria-hidden="true" /></>}>
        {close => <>
          {BLOCK_COMMANDS.filter(command => command.insert).map(command => (
            <MenuItem key={command.id} icon={command.icon} title={command.title} hint={command.hint} kbd={command.kbd}
              disabled={command.id === "image" && modeLocked}
              onSelect={() => { close(); if (editor) command.run(editor, { onImage }); }} />
          ))}
          <p className="kp-menu-foot">Tip: type <span className="kp-kbd">/</span> on an empty line to insert without leaving the keyboard.</p>
        </>}
      </Dropdown>
      <span className="kp-tb-spacer" />
      {button("Undo", <FlipBackward size={18} />, () => editor?.chain().focus().undo().run(), { shortcut: `${MOD} Z`, disabled: !editor?.can().undo() })}
      {button("Redo", <FlipForward size={18} />, () => editor?.chain().focus().redo().run(), { shortcut: `${MOD} Shift Z`, disabled: !editor?.can().redo() })}
      <span className="kp-mode" role="group" aria-label="Editor mode">
        {(["visual", "markdown"] as const).map(m => (
          <button type="button" key={m} aria-pressed={mode === m} disabled={modeLocked && mode !== m} title={modeLocked && mode !== m ? lockedTitle : undefined}
            onClick={() => onModeChange(m)}>{m === "visual" ? "Visual" : "Markdown"}</button>
        ))}
      </span>
    </div>
  );
}
