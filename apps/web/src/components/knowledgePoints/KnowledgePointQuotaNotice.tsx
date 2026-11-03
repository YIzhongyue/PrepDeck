import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { useI18n } from "../../i18n";
import { useKnowledgePoints } from "../../store/useKnowledgePoints";

interface Usage { userId: string; notes: number; bodyBytes: number; images: number; imageBytes: number;
  limits: { notes: number; bodyBytes: number; images: number; imageBytes: number } }

function validUsage(value: unknown, userId: string): value is Usage {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<Usage>;
  if (data.userId !== userId || !data.limits || typeof data.limits !== "object") return false;
  return (["notes", "bodyBytes", "images", "imageBytes"] as const).every(key =>
    typeof data[key] === "number" && Number.isFinite(data[key]) && data[key]! >= 0
    && typeof data.limits![key] === "number" && Number.isFinite(data.limits![key]) && data.limits![key] > 0);
}

function QuotaNoticeForUser({ userId }: { userId: string | null }) {
  const { t } = useI18n();
  const { state } = useKnowledgePoints();
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    if (!userId) return;
    let active = true;
    let request = 0;
    const refresh = () => {
      const sequence = ++request;
      void apiFetch<unknown>("/api/knowledge-points/usage")
        .then(value => { if (active && sequence === request) setUsage(validUsage(value, userId) ? value : null); })
        .catch(() => { if (active && sequence === request) setUsage(null); });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { active = false; window.removeEventListener("focus", refresh); };
  }, [userId, state.lastSavedAt, state.total, state.uploading]);
  if (!userId || !usage || usage.userId !== userId) return null;
  const near = (Object.keys(usage.limits) as (keyof Usage["limits"])[])
    .some(key => usage[key] >= usage.limits[key] * 0.9);
  return <aside aria-live="polite" style={{ padding: "8px 16px" }}>
    <small>{t("quota.usage", { notes: usage.notes, body: (usage.bodyBytes / 1048576).toFixed(1),
      images: usage.images, imageBytes: (usage.imageBytes / 1048576).toFixed(1) })}</small>
    {near && <p>{t("quota.near")}</p>}
  </aside>;
}

export default function KnowledgePointQuotaNotice({ userId }: { userId: string | null }) {
  // Recreate the lifecycle even for A -> signed out -> A, so old usage cannot
  // reappear while the new session's request is pending.
  return <QuotaNoticeForUser key={userId ?? "signed-out"} userId={userId} />;
}