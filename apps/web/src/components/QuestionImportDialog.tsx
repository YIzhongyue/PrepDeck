import QuestionContent from "./QuestionContent";
import { useEffect, useState } from "react";
import { formatAnswerText, normalizeImportFile, type ValidationIssue, type getImportSchemas } from "@prepdeck/shared";
import { apiFetch } from "../lib/api";
import ModalLayer from "./ModalLayer";
import { t as translate, useI18n } from "../i18n";

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
  const { t } = useI18n();
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
      if (upload.size > 5 * 1024 * 1024) throw new Error(translate("authoring.import.tooLarge"));
      const data = JSON.parse(await upload.text());
      const checked = await apiFetch<Preview>(`/api/exams/${examId}/import/validate`, { method: "POST", body: JSON.stringify(data) });
      setFile(data); setPreview(checked);
    } catch (err) { setError(err instanceof Error ? err.message : translate("authoring.import.validateFailed")); }
    finally { setBusy(false); }
  };
  const execute = async () => {
    if (!file || !preview?.valid || busy || result) return;
    setBusy(true); setError("");
    try {
      const response = await apiFetch<Result>(`/api/exams/${examId}/import`, { method: "POST", body: JSON.stringify({ ...file,
        conflictResolutions: preview.conflicts.map(c => ({ questionId: c.questionId, expectedRevision: c.expectedRevision, incomingToken: c.incomingToken, action: choices[c.questionId] ?? "keep" })) }) });
      setResult(response); onImported();
    } catch (err) { setError(err instanceof Error ? err.message : translate("authoring.import.failed")); setPreview(null); }
    finally { setBusy(false); }
  };
  return <ModalLayer label={t("authoring.import.title")} onClose={close}><div className="dialog question-editor">
    <h3>{t("authoring.import.title")}</h3><p>{t("authoring.import.intro")}</p>
    <details>
      <summary>{t("authoring.import.pdfTitle")}</summary>
      <p>{t("authoring.import.pdfBody")}</p>
      {schemas && <p>{t("authoring.import.capabilities", { blocks: schemas.capabilities.blocks.join(", "), interactions: schemas.capabilities.interactions.join(", ") })}</p>}
      {schemaError && <p role="status">{t("authoring.import.schemasFailed")}</p>}
      {!schemas && !schemaError && <p role="status">{t("authoring.import.schemasLoading")}</p>}
      <a href="/api/import-schemas" download="prepdeck-import-schemas.json">{t("authoring.import.downloadSchemas")}</a>
    </details>
    <input aria-label={t("authoring.import.file")} type="file" accept=".json,application/json" disabled={busy} onChange={e => { const upload = e.target.files?.[0]; if (upload) void readFile(upload); e.target.value = ""; }} />
    {busy && <p role="status">{t("authoring.import.processing")}</p>}{error && <p className="authoring-errors" role="alert">{error}</p>}
    {preview && !result && <><p>{t("authoring.import.incoming", { count: preview.questionCount })} · {t("authoring.import.conflicts", { count: preview.conflicts.length })}</p>
      {preview.valid && file && <details><summary>{t("authoring.import.previewTitle")}</summary>{normalizeImportFile(file).questions.slice(0, 5).map((q, i) => <section key={i} className="authoring-preview"><h4>{q.externalId ?? t("study.questionN", { n: i + 1 })}</h4><QuestionContent src={q.stem} content={q.content} />{q.options?.map(o => <div key={o.id}><strong>{o.id}</strong><QuestionContent src={o.text} content={q.content} optionId={o.id} /></div>)}<p>{t("study.structured.correctResponse", { response: formatAnswerText(q, q.correctAnswers) })}</p></section>)}<p>{t("authoring.import.previewNote")}</p></details>}
      {preview.issues.map((i, n) => <p key={n} className="authoring-errors">{i.path}: {i.message}</p>)}
      {preview.conflicts.map(c => <section key={c.questionId} className="authoring-preview"><p className="authoring-identifier">{c.externalId} · {c.questionId} · {t("authoring.editor.revision", { revision: String(c.expectedRevision) })}</p><p>{c.reason.replaceAll("_", " ")}</p>
        {c.differences.map(d => <div key={d.field}><strong>{d.field}</strong><div className="authoring-toolbar"><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", flex: "1 1 250px" }}>{t("authoring.import.current", { value: JSON.stringify(d.current, null, 2) })}</pre><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", flex: "1 1 250px" }}>{t("authoring.import.incomingValue", { value: JSON.stringify(d.incoming, null, 2) })}</pre></div></div>)}
        {c.reason === "ambiguous_external_id" ? <p>{t("authoring.import.ambiguous")}</p> : <label>{t("authoring.import.resolution")} <select className="input" disabled={busy} value={choices[c.questionId] ?? "keep"} onChange={e => setChoices(x => ({ ...x, [c.questionId]: e.target.value as "keep" | "apply" }))}><option value="keep">{t("authoring.import.keep")}</option><option value="apply">{t("authoring.import.apply")}</option></select></label>}
      </section>)}
    </>}
    {result && <section aria-label={t("authoring.import.results")}><p role="status">{t("authoring.import.summary", { created: result.created, updated: result.updated, skipped: result.skipped, failed: result.failed })}</p>
      <p>{t("authoring.import.retryNote")}</p>
      {result.outcomes.map((o, i) => <p key={i} className="authoring-identifier">{o.externalId ?? o.questionId}: {o.status}{o.reason && ` — ${o.reason}`}</p>)}
    </section>}
    <div className="dialog-actions"><button className="btn btn-secondary" type="button" disabled={busy} onClick={close}>{t("common.close")}</button><button className="btn btn-primary" type="button" disabled={busy || !preview?.valid || !!result} onClick={execute}>{t("authoring.import.execute")}</button></div>
  </div></ModalLayer>;
}
