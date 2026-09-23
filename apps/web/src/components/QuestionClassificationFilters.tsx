import { useEffect, useState } from "react";
import { UNCLASSIFIED_QUESTION_VALUE, type QuestionClassificationCatalog } from "@prepdeck/shared";
import { apiFetch } from "../lib/api";

export default function QuestionClassificationFilters({ examId, revision, selected, onChange }: {
  examId: string; revision: number; selected: Record<string, string>; onChange: (selected: Record<string, string>) => void;
}) {
  const [catalog, setCatalog] = useState<QuestionClassificationCatalog | null>(null), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setFailed(false);
    apiFetch<QuestionClassificationCatalog>(`/api/exams/${examId}/questions/classifications`, { signal: controller.signal })
      .then(data => {
        if (!Array.isArray(data.dimensions)) throw new Error("Invalid classification catalog");
        if (!controller.signal.aborted) setCatalog(data);
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [examId, revision, retry]);
  useEffect(() => {
    if (!catalog) return;
    const next = Object.fromEntries(Object.entries(selected).filter(([id, value]) => catalog.dimensions.some(d => d.id === id
      && (value === UNCLASSIFIED_QUESTION_VALUE || d.values.some(v => v.id === value)))));
    if (Object.keys(next).length !== Object.keys(selected).length) onChange(next);
  }, [catalog, selected, onChange]);
  return <>
    {catalog?.dimensions?.map(dimension => <label key={dimension.id} className="field" style={{ margin: 0 }}>
      <span>{dimension.label}</span>
      <select className="input" aria-label={`Filter by ${dimension.label}`} value={selected[dimension.id] ?? ""} onChange={e => {
        const next = { ...selected }; if (e.target.value) next[dimension.id] = e.target.value; else delete next[dimension.id]; onChange(next);
      }}>
        <option value="">{dimension.allLabel}</option>
        {dimension.values.map(value => <option key={value.id} value={value.id}>{value.label} ({value.count})</option>)}
        {(dimension.unclassifiedCount > 0 || selected[dimension.id] === UNCLASSIFIED_QUESTION_VALUE) && <option value={UNCLASSIFIED_QUESTION_VALUE}>Unclassified / ambiguous ({dimension.unclassifiedCount})</option>}
      </select>
    </label>)}
    {failed && <span role="status">Classification filters could not be loaded. <button type="button" className="btn btn-secondary" onClick={() => setRetry(n => n + 1)}>Retry filters</button></span>}
  </>;
}
