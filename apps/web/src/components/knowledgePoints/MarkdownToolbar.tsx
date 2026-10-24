import type { Editor } from "@tiptap/react";
import { Bold01, ChevronDown, Code01, Dotpoints01, FlipBackward, FlipForward, Italic01, Link01, Plus } from "@untitledui/icons";
import type { ReactNode } from "react";
import { Dropdown, MenuItem } from "./EditorMenu";
import { BLOCK_COMMANDS, MOD, NumberedListIcon, QuoteIcon } from "./editorCommands";
import { useI18n } from "../../i18n";

export type EditorMode = "visual" | "markdown";

// Labels are the `kp.toolbar.styles` messages.
const STYLES = [
  { level: 0, kbd: `${MOD} Alt 0` },
  { level: 1, kbd: "#" },
  { level: 2, kbd: "##" },
  { level: 3, kbd: "###" },
] as const;

export default function MarkdownToolbar({ editor, mode, modeLocked, onModeChange, onImage, onLink }: {
  editor: Editor | null; mode: EditorMode; onModeChange: (mode: EditorMode) => void;
  modeLocked?: boolean;
  onImage: () => void; onLink: () => void;
}) {
  const { t, rich } = useI18n();
  const styleLabel = (level: 0 | 1 | 2 | 3) => t(`kp.toolbar.styles.h${level}`);
  const off = !editor || mode !== "visual";
  const level = editor?.isActive("heading") ? Number(editor.getAttributes("heading").level) : 0;
  const current = STYLES.find(style => style.level === level) ?? STYLES[0];
  const button = (label: string, icon: ReactNode, action: () => void, options: { active?: boolean; shortcut?: string; disabled?: boolean } = {}) => (
    <button type="button" className="kp-tb-btn" aria-label={label} title={options.shortcut ? `${label} · ${options.shortcut}` : label}
      aria-pressed={options.active === undefined ? undefined : options.active} disabled={off || options.disabled}
      onMouseDown={event => event.preventDefault()} onClick={action}>{icon}</button>
  );
  const lockedTitle = t("kp.toolbar.locked");

  return (
    <div className="kp-toolbar" role="toolbar" aria-label={t("kp.toolbar.label")}>
      <Dropdown label={t("kp.toolbar.textStyleCurrent", { style: styleLabel(current.level) })} menuLabel={t("kp.toolbar.textStyle")} triggerClassName="kp-tb-style" disabled={off} width={260}
        trigger={<><span>{styleLabel(current.level)}</span><ChevronDown size={14} aria-hidden="true" /></>}>
        {close => STYLES.map(style => (
          <MenuItem key={style.level} checked={style.level === level} kbd={style.kbd}
            title={<span className={`kp-style-sample kp-style-${style.level}`}>{styleLabel(style.level)}</span>}
            onSelect={() => {
              close();
              if (style.level) editor?.chain().focus().setHeading({ level: style.level }).run();
              else editor?.chain().focus().setParagraph().run();
            }} />
        ))}
      </Dropdown>
      <span className="kp-tb-sep" aria-hidden="true" />
      {button(t("annotations.bold"), <Bold01 size={18} />, () => editor?.chain().focus().toggleBold().run(), { active: !!editor?.isActive("bold"), shortcut: `${MOD} B` })}
      {button(t("kp.editor.italic"), <Italic01 size={18} />, () => editor?.chain().focus().toggleItalic().run(), { active: !!editor?.isActive("italic"), shortcut: `${MOD} I` })}
      {button(t("kp.editor.inlineCode"), <Code01 size={18} />, () => editor?.chain().focus().toggleCode().run(), { active: !!editor?.isActive("code"), shortcut: `${MOD} E` })}
      {button(t("kp.toolbar.link"), <Link01 size={18} />, onLink, { active: !!editor?.isActive("link"), shortcut: `${MOD} K` })}
      <span className="kp-tb-sep" aria-hidden="true" />
      {button(t("kp.blocks.bullets.title"), <Dotpoints01 size={18} />, () => editor?.chain().focus().toggleBulletList().run(), { active: !!editor?.isActive("bulletList"), shortcut: "- space" })}
      {button(t("kp.blocks.numbers.title"), <NumberedListIcon className="kp-ico-18" />, () => editor?.chain().focus().toggleOrderedList().run(), { active: !!editor?.isActive("orderedList"), shortcut: "1. space" })}
      {button(t("kp.blocks.quote.title"), <QuoteIcon className="kp-ico-18" />, () => editor?.chain().focus().toggleBlockquote().run(), { active: !!editor?.isActive("blockquote"), shortcut: "> space" })}
      <span className="kp-tb-sep" aria-hidden="true" />
      <Dropdown menuLabel={t("kp.toolbar.insert")} triggerClassName="kp-tb-insert" disabled={off} width={316}
        trigger={<><Plus size={16} aria-hidden="true" />{t("kp.toolbar.insert")}<ChevronDown size={14} aria-hidden="true" /></>}>
        {close => <>
          {BLOCK_COMMANDS.filter(command => command.insert).map(command => (
            <MenuItem key={command.id} icon={command.icon} title={command.title} hint={command.hint} kbd={command.kbd}
              disabled={command.id === "image" && modeLocked}
              onSelect={() => { close(); if (editor) command.run(editor, { onImage }); }} />
          ))}
          <p className="kp-menu-foot">{rich("kp.toolbar.tip", { kbd: (chunks) => <span className="kp-kbd">{chunks}</span> })}</p>
        </>}
      </Dropdown>
      <span className="kp-tb-spacer" />
      {button(t("kp.toolbar.undo"), <FlipBackward size={18} />, () => editor?.chain().focus().undo().run(), { shortcut: `${MOD} Z`, disabled: !editor?.can().undo() })}
      {button(t("kp.toolbar.redo"), <FlipForward size={18} />, () => editor?.chain().focus().redo().run(), { shortcut: `${MOD} Shift Z`, disabled: !editor?.can().redo() })}
      <span className="kp-mode" role="group" aria-label={t("kp.toolbar.mode")}>
        {(["visual", "markdown"] as const).map(m => (
          <button type="button" key={m} aria-pressed={mode === m} disabled={modeLocked && mode !== m} title={modeLocked && mode !== m ? lockedTitle : undefined}
            onClick={() => onModeChange(m)}>{m === "visual" ? t("kp.toolbar.visual") : "Markdown"}</button>
        ))}
      </span>
    </div>
  );
}
