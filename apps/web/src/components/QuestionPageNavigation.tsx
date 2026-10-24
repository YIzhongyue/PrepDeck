import { useEffect, useId, useState } from "react";
import { useI18n } from "../i18n";

export default function QuestionPageNavigation({ offset, total, limit, loading, onRequest }: {
  offset: number; total: number; limit: number; loading: boolean; onRequest: (offset: number) => void;
}) {
  const current = Math.floor(offset / limit) + 1, pages = Math.max(1, Math.ceil(total / limit));
  const [target, setTarget] = useState(String(current)), [error, setError] = useState("");
  const errorId = useId();
  const { t } = useI18n();
  useEffect(() => { setTarget(String(current)); setError(""); }, [current, pages]);
  const submit = () => {
    if (loading || !total) return;
    const value = target.trim(), destination = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(destination) || destination < 1 || destination > pages) {
      setError(t("pager.invalid", { pages })); return;
    }
    setError("");
    if (destination !== current) onRequest((destination - 1) * limit);
  };
  return <form className="authoring-toolbar authoring-feedback" aria-label={t("pager.label")} onSubmit={e => { e.preventDefault(); submit(); }}>
    <button type="button" className="btn btn-secondary" disabled={loading || offset === 0} onClick={() => onRequest(Math.max(0, offset - limit))}>{t("common.previous")}</button>
    <span aria-live="polite">{t("pager.page", { current, pages })}</span>
    <button type="button" className="btn btn-secondary" disabled={loading || offset + limit >= total} onClick={() => onRequest(offset + limit)}>{t("common.next")}</button>
    <label className="authoring-toolbar">{t("pager.goTo")}
      <input className="input" style={{ width: "5rem" }} type="text" inputMode="numeric" value={target} disabled={loading || !total}
        aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
        onChange={e => { setTarget(e.target.value); setError(""); }} />
    </label>
    <button type="submit" className="btn btn-secondary" disabled={loading || !total || /^\d+$/.test(target.trim()) && Number(target) === current}>{t("learning.live.go")}</button>
    {error && <span id={errorId} role="alert" className="authoring-errors" style={{ flexBasis: "100%" }}>{error}</span>}
  </form>;
}
