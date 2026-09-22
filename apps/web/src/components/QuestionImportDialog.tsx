import { useEffect, useState } from "react";
import { type ValidationIssue, type getImportSchemas } from "@prepdeck/shared";
import { apiFetch } from "../lib/api";

interface Conflict {
  questionId: string; externalId: string; expectedRevision: number; incomingToken: string; reason: string;
  differences: { field: string; current: unknown; incoming: unknown }[];
}
interface Preview { valid: boolean; questionCount: number; issues: ValidationIssue[]; conflicts: Conflict[] }
interface Result { created: number; updated: number; skipped: number; failed: number; outcomes: { questionId: string; externalId: string | null; status: string; reason?: string }[] }

export default function QuestionImportDialog({ examId, onClose, onImported }: { examId: string; onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<Record<string, unknown> | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [choices, setChoices] = useState<Record<string, "keep" | "apply">>({});
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [schemas, setSchemas] = useState<ReturnType<typeof getImportSchemas> | null>(null);
  const [schemaError, setSchemaError] = useState(false);
  useEffect(() => {
    let active = true;
    apiFetch<ReturnType<typeof getImportSchemas>>("/api/import-schemas")
      .then(data => { if (active) setSchemas(data); })
      .catch(() => { if (active) setSchemaError(true); });
    return () => { active = false; };
  }, []);
  const close = () => { if (!busy) onClose(); };
  const readFile = async (upload: File) => {
    setBusy(true); setError(""); setResult(null); setPreview(null); setFile(null); setChoices({});
    try {
      if (upload.size > 5 * 1024 * 1024) throw new Error("Import file must be at most 5 MiB.");
      const data = JSON.parse(await upload.text());
      const checked = await apiFetch<Preview>(`/api/exams/${examId}/import/validate`, { method: "POST", body: JSON.stringify(data) });
      setFile(data); setPreview(checked);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not validate file."); }
    finally { setBusy(false); }
  };
  const execute = async () => {
    if (!file || !preview?.valid || busy || result) return;
    setBusy(true); setError("");
    try {
      const response = await apiFetch<Result>(`/api/exams/${examId}/import`, { method: "POST", body: JSON.stringify({ ...file,
        conflictResolutions: preview.conflicts.map(c => ({ questionId: c.questionId, expectedRevision: c.expectedRevision, incomingToken: c.incomingToken, action: choices[c.questionId] ?? "keep" })) }) });
      setResult(response); onImported();
    } catch (err) { setError(err instanceof Error ? err.message : "Import failed. Refresh the preview before retrying."); setPreview(null); }
    finally { setBusy(false); }
  };
  return <div className="dialog-backdrop" style={{ zIndex: 70 }} onClick={close}><div className="dialog question-editor" role="dialog" aria-modal="true" aria-label="Import questions" onClick={e => e.stopPropagation()}>
    <h3>Import questions</h3><p>New questions are appended to this exam. Existing content is kept unless you explicitly apply an incoming version below.</p>
    <details>
      <summary>Prepare questions from a PDF</summary>
      <p>Convert your PDF with the pdf-to-quiz skill, check the questions and answers against the original pages, then upload the resulting JSON below.</p>
      {schemas?.layouts.map(layout => <div key={layout.id}>
        <strong>{layout.name}</strong><p>{layout.description}</p>
      </div>)}
      {schemaError && <p role="status">PDF preparation formats could not be loaded. You can still import a prepared JSON file.</p>}
      {!schemas && !schemaError && <p role="status">Loading PDF preparation formats…</p>}
      <a href="/api/import-schemas" download="prepdeck-import-schemas.json">Download conversion schemas</a>
    </details>
    <input aria-label="Question import JSON file" type="file" accept=".json,application/json" disabled={busy} onChange={e => { const upload = e.target.files?.[0]; if (upload) void readFile(upload); e.target.value = ""; }} />
    {busy && <p role="status">Processing…</p>}{error && <p className="authoring-errors" role="alert">{error}</p>}
    {preview && !result && <><p>{preview.questionCount} incoming questions · {preview.conflicts.length} conflicts</p>
      {preview.issues.map((i, n) => <p key={n} className="authoring-errors">{i.path}: {i.message}</p>)}
      {preview.conflicts.map(c => <section key={c.questionId} className="authoring-preview"><p className="authoring-identifier">{c.externalId} · {c.questionId} · revision {c.expectedRevision}</p><p>{c.reason.replaceAll("_", " ")}</p>
        {c.differences.map(d => <div key={d.field}><strong>{d.field}</strong><div className="authoring-toolbar"><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", flex: "1 1 250px" }}>Current: {JSON.stringify(d.current, null, 2)}</pre><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", flex: "1 1 250px" }}>Incoming: {JSON.stringify(d.incoming, null, 2)}</pre></div></div>)}
        {c.reason === "ambiguous_external_id" ? <p>Multiple questions share this external ID. Correct their IDs in the editor, then validate the import again.</p> : <label>Resolution <select className="input" disabled={busy} value={choices[c.questionId] ?? "keep"} onChange={e => setChoices(x => ({ ...x, [c.questionId]: e.target.value as "keep" | "apply" }))}><option value="keep">Keep current</option><option value="apply">Apply incoming version</option></select></label>}
      </section>)}
    </>}
    {result && <section aria-label="Import results"><p role="status">Created {result.created} · Updated {result.updated} · Skipped / conflicting {result.skipped} · Failed {result.failed}</p>
      <p>Only retry failed or conflicting records. Questions without external IDs are new records on every import.</p>
      {result.outcomes.map((o, i) => <p key={i} className="authoring-identifier">{o.externalId ?? o.questionId}: {o.status}{o.reason && ` — ${o.reason}`}</p>)}
    </section>}
    <div className="dialog-actions"><button className="btn btn-secondary" type="button" disabled={busy} onClick={close}>Close</button><button className="btn btn-primary" type="button" disabled={busy || !preview?.valid || !!result} onClick={execute}>Import with selected resolutions</button></div>
  </div></div>;
}
