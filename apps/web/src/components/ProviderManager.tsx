import { useState } from "react";
import type { Provider } from "@prepdeck/shared";
import { AdminModal } from "./AdminModal";
import { apiFetch, ApiError } from "../lib/api";
import { IMAGE_UPLOAD_TYPES, MAX_IMAGE_UPLOAD_BYTES } from "../lib/avatar";
import { useI18n } from "../i18n";

type Props = {
  mode: "new" | "manage";
  providers: Provider[];
  onChange: (provider: Provider) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
};

export default function ProviderManager({ mode, providers, onChange, onDelete, onClose }: Props) {
  const [editing, setEditing] = useState(mode === "new");
  const [selected, setSelected] = useState<Provider | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const close = () => { if (!busy) onClose(); };
  const title = t(editing ? selected ? "admin.providers.edit" : "admin.providers.new" : "admin.providers.manage");
  const edit = (provider: Provider | null) => { setSelected(provider); setError(null); setEditing(true); };

  const act = async (provider: Provider, action: "archive" | "unarchive" | "delete") => {
    if (action === "delete" && !window.confirm(t("admin.providers.deleteConfirm", { name: provider.name }))) return;
    setBusy(true); setError(null);
    try {
      if (action === "delete") {
        await apiFetch(`/api/providers/${provider.id}`, { method: "DELETE" });
        onDelete(provider.id);
      } else {
        const result = await apiFetch<{ provider: Provider }>(`/api/providers/${provider.id}/${action}`, { method: "POST" });
        onChange(result.provider);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("admin.providers.updateFailed"));
    } finally { setBusy(false); }
  };

  return (
    <AdminModal icon="shield" title={title} onClose={close} closeDisabled={busy}
      subtitle={t(editing ? "admin.providers.editSubtitle" : "admin.providers.manageSubtitle")}>
      {editing ? (
        <ProviderEditor key={selected?.id ?? "new"} provider={selected} onBusy={setBusy} onChange={onChange}
          onClose={() => { if (mode === "new") onClose(); else setEditing(false); }} />
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> {t("admin.providers.showArchived")}</label>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => edit(null)}>{t("admin.providers.new")}</button>
          </div>
          {error && <p role="alert" style={{ color: "var(--color-danger)", overflowWrap: "anywhere" }}>{error}</p>}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {providers.filter((p) => showArchived || !p.archivedAt).map((provider) => (
              <section key={provider.id} aria-label={provider.name} className="admin-panel-card" style={{ margin: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span className="admin-exam-badge">{provider.iconUrl ? <img src={provider.iconUrl} alt="" /> : provider.shortName.slice(0, 4)}</span>
                  <div style={{ minWidth: 0, flex: 1, overflowWrap: "anywhere" }}>
                    <strong>{provider.name}</strong>
                    <div style={{ fontSize: 13 }}>{provider.shortName}</div>
                  </div>
                  <span className={`tag ${provider.archivedAt ? "tag-neutral" : "tag-accent-2"}`}>{t(provider.archivedAt ? "admin.exams.archived" : "admin.exams.active")}</span>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => edit(provider)}>{t("common.edit")}</button>
                  <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void act(provider, provider.archivedAt ? "unarchive" : "archive")}>{t(provider.archivedAt ? "admin.users.restore" : "admin.exams.archive")}</button>
                  <button type="button" className="btn btn-secondary" style={{ color: "var(--color-danger)" }} disabled={busy} onClick={() => void act(provider, "delete")}>{t("common.delete")}</button>
                </div>
              </section>
            ))}
            {!providers.some((p) => showArchived || !p.archivedAt) && <p>{t(showArchived ? "admin.providers.noneAtAll" : "admin.providers.noneActive")}</p>}
          </div>
        </>
      )}
    </AdminModal>
  );
}

function ProviderEditor({ provider, onBusy, onChange, onClose }: {
  provider: Provider | null;
  onBusy: (busy: boolean) => void;
  onChange: (provider: Provider) => void;
  onClose: () => void;
}) {
  // Keep the created record if a later icon upload fails; retry must not POST
  // a second provider. Successfully saved metadata is reflected immediately.
  const [saved, setSaved] = useState(provider);
  const [name, setName] = useState(provider?.name ?? "");
  const [shortName, setShortName] = useState(provider?.shortName ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(provider?.websiteUrl ?? "");
  const [icon, setIcon] = useState<File | null>(null);
  const [removeIcon, setRemoveIcon] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); onBusy(true); setError(null);
    // Set once the metadata is saved, so a failed icon step still reports it.
    let savedMetadata: Provider | null = null;
    try {
      if (icon && (!IMAGE_UPLOAD_TYPES.has(icon.type) || icon.size > MAX_IMAGE_UPLOAD_BYTES)) {
        setError(t("admin.providers.iconRules"));
        return;
      }
      const result = await apiFetch<{ provider: Provider }>(saved ? `/api/providers/${saved.id}` : "/api/providers", {
        method: saved ? "PATCH" : "POST", body: JSON.stringify({ name, shortName, websiteUrl: websiteUrl.trim() || null }),
      });
      savedMetadata = result.provider;
      setSaved(savedMetadata);
      let updated = savedMetadata;
      if (icon) {
        const { iconUrl } = await apiFetch<{ iconUrl: string }>(`/api/providers/${updated.id}/icon`, { method: "POST", headers: { "Content-Type": icon.type }, body: icon });
        updated = { ...updated, iconUrl };
      } else if (removeIcon) {
        await apiFetch(`/api/providers/${updated.id}/icon`, { method: "DELETE" });
        updated = { ...updated, iconUrl: null };
      }
      // Notify the parent once per save, after the icon step, so one save
      // triggers one refresh.
      setSaved(updated); onChange(updated); onClose();
    } catch (err) {
      // The metadata did save, so the parent still has to reflect it.
      if (savedMetadata) onChange(savedMetadata);
      const message = err instanceof ApiError ? err.message : t("admin.providers.pleaseRetry");
      setError(`${t(savedMetadata ? "admin.providers.iconFailed" : "admin.providers.saveFailed")} ${message}`);
    } finally { setBusy(false); onBusy(false); }
  };

  return (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <fieldset disabled={busy} className="admin-modal-fields" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="field" style={{ flex: "1 1 100%" }}><label htmlFor="provider-name">{t("admin.exams.name")}</label><input id="provider-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} placeholder="Amazon Web Services" /></div>
        <div className="field" style={{ flex: "1 1 140px" }}><label htmlFor="provider-short-name">{t("admin.providers.shortName")}</label><input id="provider-short-name" className="input" value={shortName} onChange={(e) => setShortName(e.target.value)} required maxLength={80} placeholder="AWS" /></div>
        <div className="field" style={{ flex: "1 1 220px" }}><label htmlFor="provider-website">{t("admin.providers.website")}</label><input id="provider-website" type="url" className="input" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://…" /></div>
        <div className="field" style={{ flex: "1 1 100%" }}>
          <label htmlFor="provider-icon">{t("admin.providers.icon")}</label>
          {saved?.iconUrl && !removeIcon && <img src={saved.iconUrl} alt={t("admin.providers.currentIcon")} width={48} height={48} style={{ objectFit: "contain" }} />}
          <input id="provider-icon" type="file" accept="image/jpeg,image/png,image/webp" style={{ maxWidth: "100%" }} onChange={(e) => { setIcon(e.target.files?.[0] ?? null); setRemoveIcon(false); }} />
          <small>{t("admin.providers.iconHint")}</small>
          {saved?.iconUrl && !icon && <label><input type="checkbox" checked={removeIcon} onChange={(e) => setRemoveIcon(e.target.checked)} /> {t("admin.providers.removeIcon")}</label>}
        </div>
      </fieldset>
      {error && <p role="alert" style={{ margin: 0, color: "var(--color-danger)" }}>{error}</p>}
      <div className="admin-modal-foot">
        <p>{t("admin.providers.assignHint")}</p>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !shortName.trim()}>{busy ? t("common.saving") : t(saved ? "admin.providers.save" : "admin.providers.add")}</button>
      </div>
    </form>
  );
}
