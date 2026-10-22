import type { KnowledgePointDetail } from "@prepdeck/shared";
import { useState } from "react";
import ModalLayer from "../ModalLayer";
import { useI18n } from "../../i18n";

export default function DeleteKnowledgePointDialog({
  note,
  onCancel,
  onConfirm,
}: {
  note: KnowledgePointDetail;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t, formatList } = useI18n();
  const imageCount = note.images.filter((i) => i.status !== "orphaned").length;
  const linkedCount = note.linkedQuestions.length;

  return (
    <ModalLayer label={t("kp.delete.label")} onClose={() => { if (!busy) onCancel(); }}>
      <div className="dialog">
        {error && <p role="alert">{error}</p>}
        <span className="dialog-title">{t("kp.delete.title", { title: note.title || t("kp.untitled") })}</span>
        <div className="dialog-body">
          <p style={{ margin: "0 0 10px" }}>
            {t("kp.delete.removes", { items: formatList([
              t("kp.delete.theNote"),
              ...(imageCount > 0 ? [t("kp.delete.itsScreenshots", { count: imageCount })] : []),
              ...(linkedCount > 0 ? [t("kp.delete.itsLinks", { count: linkedCount })] : []),
            ]) })}
          </p>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
            {note.groupName ? t("kp.delete.keptWithGroup", { group: note.groupName }) : t("kp.delete.kept")}
          </p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onCancel}>{t("common.cancel")}</button>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setBusy(true); void onConfirm().catch(() => { setBusy(false); setError(t("kp.delete.failed")); }); }}
            style={{ padding: "8.8px 16px", border: 0, borderRadius: 999, background: "var(--color-danger)", color: "#fff", cursor: "pointer", fontFamily: "var(--font-heading)", fontSize: 14 }}
          >
            {t("kp.delete.confirm")}
          </button>
        </div>
      </div>
    </ModalLayer>
  );
}
