import { useState } from "react";
import type { Provider } from "@prepdeck/shared";
import ModalLayer from "./ModalLayer";
import { apiFetch, ApiError } from "../lib/api";

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
  const close = () => { if (!busy) onClose(); };
  const title = editing ? selected ? "Edit provider" : "New provider" : "Manage providers";
  const edit = (provider: Provider | null) => { setSelected(provider); setError(null); setEditing(true); };

  const act = async (provider: Provider, action: "archive" | "unarchive" | "delete") => {
    if (action === "delete" && !window.confirm(`Permanently delete "${provider.name}"? This cannot be undone. Providers assigned to exams cannot be deleted; archive them instead.`)) return;
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
      setError(err instanceof ApiError ? err.message : "Could not update this provider. Please retry.");
    } finally { setBusy(false); }
  };

  return (
    <ModalLayer label={title} onClose={close}>
      <div className="admin-modal">
        <div className="admin-modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3>{title}</h3>
            <p>{editing ? "Providers group exams in menus and selectors." : "Archive providers to hide them from selectors while keeping their exams and questions."}</p>
          </div>
          <button type="button" className="admin-modal-close" aria-label="Close" disabled={busy} onClick={close}>✕</button>
        </div>
        {editing ? (
          <ProviderEditor key={selected?.id ?? "new"} provider={selected} onBusy={setBusy} onChange={onChange}
            onClose={() => { if (mode === "new") onClose(); else setEditing(false); }} />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived providers</label>
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => edit(null)}>New provider</button>
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
                    <span className={`tag ${provider.archivedAt ? "tag-neutral" : "tag-accent-2"}`}>{provider.archivedAt ? "archived" : "active"}</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => edit(provider)}>Edit</button>
                    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void act(provider, provider.archivedAt ? "unarchive" : "archive")}>{provider.archivedAt ? "Restore" : "Archive"}</button>
                    <button type="button" className="btn btn-secondary" style={{ color: "var(--color-danger)" }} disabled={busy} onClick={() => void act(provider, "delete")}>Delete</button>
                  </div>
                </section>
              ))}
              {!providers.some((p) => showArchived || !p.archivedAt) && <p>No {showArchived ? "" : "active "}providers.</p>}
            </div>
          </>
        )}
      </div>
    </ModalLayer>
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

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); onBusy(true); setError(null);
    let metadataSaved = false;
    try {
      if (icon && (!["image/jpeg", "image/png", "image/webp"].includes(icon.type) || icon.size > 2 * 1024 * 1024)) {
        setError("Choose a JPEG, PNG, or WebP icon no larger than 2 MB.");
        return;
      }
      const result = await apiFetch<{ provider: Provider }>(saved ? `/api/providers/${saved.id}` : "/api/providers", {
        method: saved ? "PATCH" : "POST", body: JSON.stringify({ name, shortName, websiteUrl: websiteUrl.trim() || null }),
      });
      let updated = result.provider;
      setSaved(updated); onChange(updated); metadataSaved = true;
      if (icon) {
        const { iconUrl } = await apiFetch<{ iconUrl: string }>(`/api/providers/${updated.id}/icon`, { method: "POST", headers: { "Content-Type": icon.type }, body: icon });
        updated = { ...updated, iconUrl };
      } else if (removeIcon) {
        await apiFetch(`/api/providers/${updated.id}/icon`, { method: "DELETE" });
        updated = { ...updated, iconUrl: null };
      }
      setSaved(updated); onChange(updated); onClose();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "Please retry.";
      setError(`${metadataSaved ? "Provider saved, but its icon could not be updated." : "Could not save provider."} ${message}`);
    } finally { setBusy(false); onBusy(false); }
  };

  return (
    <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <fieldset disabled={busy} className="admin-modal-fields" style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
        <div className="field" style={{ flex: "1 1 100%" }}><label htmlFor="provider-name">Name</label><input id="provider-name" className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} placeholder="Amazon Web Services" /></div>
        <div className="field" style={{ flex: "1 1 140px" }}><label htmlFor="provider-short-name">Short name</label><input id="provider-short-name" className="input" value={shortName} onChange={(e) => setShortName(e.target.value)} required maxLength={80} placeholder="AWS" /></div>
        <div className="field" style={{ flex: "1 1 220px" }}><label htmlFor="provider-website">Official URL</label><input id="provider-website" type="url" className="input" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} placeholder="https://…" /></div>
        <div className="field" style={{ flex: "1 1 100%" }}>
          <label htmlFor="provider-icon">Icon</label>
          {saved?.iconUrl && !removeIcon && <img src={saved.iconUrl} alt="Current provider icon" width={48} height={48} style={{ objectFit: "contain" }} />}
          <input id="provider-icon" type="file" accept="image/jpeg,image/png,image/webp" style={{ maxWidth: "100%" }} onChange={(e) => { setIcon(e.target.files?.[0] ?? null); setRemoveIcon(false); }} />
          <small>JPEG, PNG, or WebP · up to 2 MB</small>
          {saved?.iconUrl && !icon && <label><input type="checkbox" checked={removeIcon} onChange={(e) => setRemoveIcon(e.target.checked)} /> Remove current icon</label>}
        </div>
      </fieldset>
      {error && <p role="alert" style={{ margin: 0, color: "var(--color-danger)" }}>{error}</p>}
      <div className="admin-modal-foot">
        <p>Assign exams from any exam’s detail page.</p>
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim() || !shortName.trim()}>{busy ? "Saving…" : saved ? "Save provider" : "Add provider"}</button>
      </div>
    </form>
  );
}
