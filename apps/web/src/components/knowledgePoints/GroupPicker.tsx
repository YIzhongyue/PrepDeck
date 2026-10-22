import { useEffect, useRef, useState } from "react";
import type { KnowledgePointGroup } from "@prepdeck/shared";
import { Check, ChevronDown, Folder, Plus } from "@untitledui/icons";
import { useClampToViewport } from "./EditorMenu";
import { useI18n } from "../../i18n";

// Mirrors the worker's normalizeGroupName (lib/knowledgePointTags.ts) so the
// common mistakes are caught before a round trip; the server stays the
// authority (its NOCASE unique index catches a group made in another tab).
const MAX_GROUP_NAME_LENGTH = 40;
const normalizeName = (raw: string) => raw.trim().replace(/\s+/g, " ");

export default function GroupPicker({
  groups,
  groupId,
  groupName,
  onSelect,
  onCreate,
}: {
  groups: KnowledgePointGroup[];
  groupId: string | null;
  groupName: string | null;
  onSelect: (groupId: string | null) => void;
  onCreate: (name: string) => Promise<KnowledgePointGroup>;
}) {
  const [open, setOpen] = useState(false);
  // null: the group list; a string: the "New group" form and its draft name.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const { t } = useI18n();
  useClampToViewport(menuRef, open);

  const close = () => { setOpen(false); setDraft(null); setError(null); };
  // Leaving the form unmounts the field that held focus; hand it back to the
  // chip so Escape and Tab keep working from where the list was opened.
  const back = () => { setDraft(null); setError(null); triggerRef.current?.focus(); };

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setDraft(null); setError(null); }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const create = () => {
    if (draft === null || busy) return;
    const name = normalizeName(draft);
    if (!name) { setError(t("kp.groupPicker.enterName")); return; }
    if (name.length > MAX_GROUP_NAME_LENGTH) { setError(t("kp.groupPicker.tooLong", { max: MAX_GROUP_NAME_LENGTH })); return; }
    if (groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) { setError(t("kp.groupPicker.exists", { name })); return; }
    setBusy(true);
    setError(null);
    onCreate(name)
      .then((group) => {
        // Changing notes unmounts this picker with its keyed editor. Creation
        // may still finish, but must not select a group on the newly open note.
        if (!ref.current) return;
        onSelect(group.id); close(); triggerRef.current?.focus();
      })
      .catch((err) => setError(err instanceof Error ? err.message : t("kp.manage.createFailed")))
      .finally(() => setBusy(false));
  };

  const name = groupId ? (groupName ?? t("kp.groupPicker.group")) : t("kp.ungrouped");
  const option = (id: string | null, label: string) => (
    <button key={id ?? ""} type="button" role="menuitemradio" aria-checked={groupId === id} className="kp-menu-item"
      onClick={() => { onSelect(id); close(); }}>
      <span className="kp-mi-text"><span className="kp-mi-title">{label}</span></span>
      {groupId === id && <Check size={16} aria-hidden="true" />}
    </button>
  );

  return (
    <div ref={ref} className="kp-dropdown" onKeyDown={(e) => {
      if (e.key !== "Escape" || !open) return;
      e.stopPropagation();
      // Escape backs out one step: from the form to the list, then closed.
      if (draft !== null) back(); else close();
    }}>
      <button ref={triggerRef} type="button" className="kp-chip" aria-label={t("kp.groupPicker.label", { name })} aria-haspopup="menu" aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}>
        <Folder size={16} aria-hidden="true" />
        {name}
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open && draft === null && (
        <div ref={menuRef} className="kp-menu kp-menu-pop" role="menu" aria-label={t("kp.groupPicker.moveTo")} style={{ left: 0, width: 240, maxHeight: 280, overflowY: "auto" }}>
          {option(null, t("kp.ungrouped"))}
          {groups.map((g) => option(g.id, g.name))}
          <div className="kp-menu-sep" role="separator" />
          <button type="button" role="menuitem" className="kp-menu-item" style={{ color: "var(--color-accent)" }} onClick={() => setDraft("")}>
            <Plus size={16} aria-hidden="true" />
            <span className="kp-mi-text"><span className="kp-mi-title">{t("kp.groupPicker.newGroupEllipsis")}</span></span>
          </button>
        </div>
      )}
      {open && draft !== null && (
        <div ref={menuRef} className="kp-menu kp-menu-pop" style={{ left: 0, width: 280 }}>
          <form className="kp-group-create" aria-label={t("kp.groupPicker.newGroup")} onSubmit={(e) => { e.preventDefault(); create(); }}>
            <label className="kp-field-label" htmlFor="kp-new-group-name">{t("kp.groupPicker.newGroup")}</label>
            <input id="kp-new-group-name" className="kp-input" autoFocus autoComplete="off" value={draft} maxLength={MAX_GROUP_NAME_LENGTH}
              placeholder={t("kp.groupPicker.namePlaceholder")} aria-invalid={!!error} aria-describedby="kp-new-group-msg" readOnly={busy}
              onChange={(e) => { setDraft(e.target.value); setError(null); }} />
            <span id="kp-new-group-msg" className={error ? "kp-field-error" : "kp-field-hint"} role={error ? "alert" : undefined}>
              {error ?? t("kp.groupPicker.hint")}
            </span>
            <div className="kp-popover-actions">
              <span className="kp-tb-spacer" />
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={back}>{t("common.back")}</button>
              <button type="submit" className="btn btn-primary" disabled={busy || !normalizeName(draft)}>{busy ? t("mcp.tokens.creating") : t("common.create")}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
