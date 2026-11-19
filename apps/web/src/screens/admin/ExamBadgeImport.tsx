import { useEffect, useId, useState } from "react";
import type { ExamBadgeImportResult, ExamBadgeSource } from "@prepdeck/shared";
import { AdminModal } from "../../components/AdminModal";
import { useI18n } from "../../i18n";
import { apiFetch, ApiError } from "../../lib/api";
import { DANGER } from "./shared";

export const emptyBadgeSource: ExamBadgeSource = { imageUrl: "", issuerUrl: "" };

export function ExamBadgeSourceFields({ source, onChange, required = false, disabled = false }: {
  source: ExamBadgeSource;
  onChange: (value: ExamBadgeSource) => void;
  required?: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <>
      <div className="field" style={{ flex: "1 1 100%" }}>
        <label htmlFor={`${id}-image`}>{t("admin.exams.badgeImageUrl")}</label>
        <input id={`${id}-image`} className="input" type="url" value={source.imageUrl} disabled={disabled}
          required={required || Boolean(source.issuerUrl.trim())} maxLength={2048}
          onChange={(e) => onChange({ ...source, imageUrl: e.target.value })} />
      </div>
      <div className="field" style={{ flex: "1 1 100%" }}>
        <label htmlFor={`${id}-issuer`}>{t("admin.exams.badgeIssuerUrl")}</label>
        <input id={`${id}-issuer`} className="input" type="url" value={source.issuerUrl} disabled={disabled}
          required={required || Boolean(source.imageUrl.trim())} maxLength={2048}
          onChange={(e) => onChange({ ...source, issuerUrl: e.target.value })} />
      </div>
    </>
  );
}

export function ExamBadgeImport({ examId, replace, onClose, onSaved }: {
  examId: string;
  replace: boolean;
  onClose: () => void;
  onSaved: (badgeIconUrl: string) => void;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState<ExamBadgeSource | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const path = `/api/exams/${examId}`;

  useEffect(() => {
    const controller = new AbortController();
    apiFetch<{ source: ExamBadgeSource | null }>(`${path}/badge-source`, { signal: controller.signal })
      .then(({ source }) => setSource(source ?? emptyBadgeSource))
      .catch(() => { if (!controller.signal.aborted) setLoadFailed(true); });
    return () => controller.abort();
  }, [path]);

  const close = () => { if (!busy) onClose(); };
  const action = t(replace ? "admin.exams.replaceBadgeFromLink" : "admin.exams.importBadge");
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !source) return;
    setBusy(true);
    setError(null);
    try {
      const { badgeImport } = await apiFetch<{ badgeImport: ExamBadgeImportResult }>(`${path}/badge/import`, {
        method: "POST",
        body: JSON.stringify({ source: { imageUrl: source.imageUrl.trim(), issuerUrl: source.issuerUrl.trim() }, replace }),
      });
      if ("badgeIconUrl" in badgeImport) {
        onSaved(badgeImport.badgeIconUrl);
        onClose();
      } else {
        setError(t(badgeImport.status === "failed" ? `admin.exams.badgeImportErrors.${badgeImport.reason}` : "admin.exams.badgeMissingSource"));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("admin.exams.badgeFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminModal icon="exams" title={action} subtitle={t("admin.exams.badgeImportHint")} onClose={close} closeDisabled={busy}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {source && (
          <div className="admin-modal-fields">
            <ExamBadgeSourceFields source={source} onChange={setSource} disabled={busy} required />
          </div>
        )}
        {!source && !loadFailed && <p role="status">{t("common.loading")}</p>}
        {loadFailed && <p role="alert" style={{ color: DANGER }}>{t("admin.exams.badgeSourceLoadFailed")}</p>}
        {error && <p role="alert" style={{ color: DANGER }}>{error}</p>}
        <div className="admin-modal-foot">
          <button type="button" className="btn btn-secondary" onClick={close} disabled={busy}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !source?.imageUrl.trim() || !source.issuerUrl.trim()}>
            {busy ? t("admin.exams.badgeImporting") : action}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}
