import { useEffect, useId, useState } from "react";

export default function QuestionPageNavigation({ offset, total, limit, loading, onRequest }: {
  offset: number; total: number; limit: number; loading: boolean; onRequest: (offset: number) => void;
}) {
  const current = Math.floor(offset / limit) + 1, pages = Math.max(1, Math.ceil(total / limit));
  const [target, setTarget] = useState(String(current)), [error, setError] = useState("");
  const errorId = useId();
  useEffect(() => { setTarget(String(current)); setError(""); }, [current, pages]);
  const submit = () => {
    if (loading || !total) return;
    const value = target.trim(), destination = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(destination) || destination < 1 || destination > pages) {
      setError(`Enter a whole page number from 1 to ${pages}.`); return;
    }
    setError("");
    if (destination !== current) onRequest((destination - 1) * limit);
  };
  return <form className="authoring-toolbar authoring-feedback" aria-label="Question pages" onSubmit={e => { e.preventDefault(); submit(); }}>
    <button type="button" className="btn btn-secondary" disabled={loading || offset === 0} onClick={() => onRequest(Math.max(0, offset - limit))}>Previous</button>
    <span aria-live="polite">Page {current} of {pages}</span>
    <button type="button" className="btn btn-secondary" disabled={loading || offset + limit >= total} onClick={() => onRequest(offset + limit)}>Next</button>
    <label className="authoring-toolbar">Go to page
      <input className="input" style={{ width: "5rem" }} type="text" inputMode="numeric" value={target} disabled={loading || !total}
        aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
        onChange={e => { setTarget(e.target.value); setError(""); }} />
    </label>
    <button type="submit" className="btn btn-secondary" disabled={loading || !total || /^\d+$/.test(target.trim()) && Number(target) === current}>Go</button>
    {error && <span id={errorId} role="alert" className="authoring-errors" style={{ flexBasis: "100%" }}>{error}</span>}
  </form>;
}
