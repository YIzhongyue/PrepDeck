import { useId, useState } from "react";
import type { Exam, OfficialMockFormat } from "@prepdeck/shared";
import { AdminModal } from "../../components/AdminModal";
import { apiFetch, ApiError } from "../../lib/api";
import { questionBankChanged } from "../../lib/questionAuthoring";
import { type ExamRow, DANGER } from "./shared";

// Per-exam settings edited from the Content tab's exam detail.

// Mirrors the worker's EXAM_SLUG_PATTERN (apps/worker/src/lib/examManagement.ts),
// which PATCH /api/exams/:id enforces whatever this form lets through.
const EXAM_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type ExamMetadataPatch = Partial<Pick<Exam, "name" | "slug" | "subject" | "language" | "description" | "passMarkPct">>;

// Name, slug, subject, language, description and pass mark after creation
// (issue #95), through the same PATCH /api/exams/:id the format card uses. Only
// changed fields are sent, so this never overwrites the official format, and a
// blank optional field is sent as null, which clears it.
export function ExamMetadataModal({ exam, onSaved, onClose }: { exam: ExamRow; onSaved: (exam: ExamRow) => void; onClose: () => void }) {
  const [name, setName] = useState(exam.name);
  const [slug, setSlug] = useState(exam.slug);
  const [subject, setSubject] = useState(exam.subject ?? "");
  const [language, setLanguage] = useState(exam.language ?? "");
  const [description, setDescription] = useState(exam.description ?? "");
  const [passMark, setPassMark] = useState(exam.passMarkPct == null ? "" : String(exam.passMarkPct));
  const [slugConfirmed, setSlugConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const text = (value: string | null) => value?.trim() || null;
  const pct = passMark.trim() === "" ? null : Number(passMark);
  const patch: ExamMetadataPatch = {};
  if (name.trim() !== exam.name) patch.name = name.trim();
  if (slug.trim() !== exam.slug) patch.slug = slug.trim();
  if (text(subject) !== text(exam.subject)) patch.subject = text(subject);
  if (text(language) !== text(exam.language)) patch.language = text(language);
  if (text(description) !== text(exam.description)) patch.description = text(description);
  if (pct !== (exam.passMarkPct ?? null)) patch.passMarkPct = pct;
  const slugChanged = patch.slug !== undefined;

  const problem = !name.trim() ? "Name is required."
    : !EXAM_SLUG_PATTERN.test(slug.trim()) ? "Slug: lowercase letters and digits in hyphen-separated groups, e.g. aws-sap-c02."
    : pct != null && !(pct >= 0 && pct <= 100) ? "Pass mark is a percentage from 0 to 100."
    : null;
  const dirty = Object.keys(patch).length > 0;

  const edit = (set: (value: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    set(e.target.value);
    setError(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || !dirty || (slugChanged && !slugConfirmed)) return;
    setBusy(true);
    setError(null);
    try {
      const { exam: updated } = await apiFetch<{ exam: ExamRow }>(`/api/exams/${exam.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      onSaved(updated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save these details.");
      setBusy(false);
    }
  };

  return (
    <AdminModal icon="exams" title="Edit exam details" subtitle="Badge, providers, official format and archiving are edited separately." closeDisabled={busy} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="admin-modal-fields">
          <div className="field" style={{ flex: "1 1 100%" }}>
            <label htmlFor={`${id}-name`}>Name</label>
            <input id={`${id}-name`} className="input" value={name} onChange={edit(setName)} maxLength={200} required />
          </div>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor={`${id}-slug`}>Slug</label>
            <input id={`${id}-slug`} className="input" value={slug} onChange={(e) => { edit(setSlug)(e); setSlugConfirmed(false); }} autoCapitalize="off" spellCheck={false} required />
          </div>
          <div className="field" style={{ flex: "1 1 160px" }}>
            <label htmlFor={`${id}-subject`}>Subject</label>
            <input id={`${id}-subject`} className="input" value={subject} onChange={edit(setSubject)} maxLength={200} />
          </div>
          <div className="field" style={{ flex: "0 1 110px" }}>
            <label htmlFor={`${id}-language`}>Language</label>
            <input id={`${id}-language`} className="input" value={language} onChange={edit(setLanguage)} maxLength={50} />
          </div>
          <div className="field" style={{ flex: "1 1 100%" }}>
            <label htmlFor={`${id}-description`}>Description</label>
            <textarea id={`${id}-description`} className="input" rows={3} value={description} onChange={edit(setDescription)} maxLength={2000} />
          </div>
          <div className="field" style={{ flex: "1 1 100%" }}>
            <label htmlFor={`${id}-pass`}>Pass mark (%)</label>
            <input id={`${id}-pass`} className="input" type="number" min={0} max={100} step="any" inputMode="decimal" value={passMark} onChange={edit(setPassMark)} style={{ maxWidth: 140 }} />
            <p className="admin-modal-hint">
              {exam.officialFormat
                ? "Not used while the official exam format is set: mocks pass at that format's share of correct answers."
                : "Mock exams pass at this share of correct answers. Leave blank for no pass mark."}
            </p>
          </div>
        </div>

        {slugChanged && !problem && (
          <div className="admin-modal-warning">
            <p>
              The slug is part of this exam's URLs and of the links in daily review emails already sent, and import files
              and integrations may refer to it. Links that use <span className="mono">{exam.slug}</span> stop working once it changes.
            </p>
            <label>
              <input type="checkbox" checked={slugConfirmed} onChange={(e) => setSlugConfirmed(e.target.checked)} />
              <span>Change the slug to <span className="mono">{slug.trim()}</span></span>
            </label>
          </div>
        )}

        {(error || problem) && <p role="alert" style={{ margin: 0, fontSize: 12, color: DANGER }}>{error ?? problem}</p>}
        <div className="admin-modal-foot">
          <p>{dirty ? "Only the fields you changed are saved." : "No changes yet."}</p>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !dirty || !!problem || (slugChanged && !slugConfirmed)}>{busy ? "Saving…" : "Save details"}</button>
        </div>
      </form>
    </AdminModal>
  );
}

// The real test's length, time limit and pass count. Mock setup offers Full /
// Half / Sprint formats derived from it, and every mock of this exam passes at
// the same share of correct answers (packages/shared/src/examFormat.ts).
export function OfficialFormatCard({ exam, onSaved }: { exam: ExamRow; onSaved: (format: OfficialMockFormat | null) => void }) {
  const saved = exam.officialFormat ?? null;
  const [questions, setQuestions] = useState(saved ? String(saved.questionCount) : "");
  const [minutes, setMinutes] = useState(saved ? String(saved.timeLimitMinutes) : "");
  const [pass, setPass] = useState(saved ? String(saved.passCorrectCount) : "");
  const [status, setStatus] = useState<{ kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }>({ kind: "idle" });
  const id = useId();

  const q = Number(questions), m = Number(minutes), p = Number(pass);
  const whole = (n: number) => Number.isInteger(n) && n > 0;
  const problem = !questions || !minutes || !pass ? "Fill in all three values."
    : !whole(q) || !whole(m) || !whole(p) ? "Use whole numbers above zero."
    : p > q ? "Correct answers to pass cannot exceed the number of questions."
    : null;
  const dirty = !saved || saved.questionCount !== q || saved.timeLimitMinutes !== m || saved.passCorrectCount !== p;

  const save = async (format: OfficialMockFormat | null) => {
    setStatus({ kind: "saving" });
    try {
      const { exam: updated } = await apiFetch<{ exam: ExamRow }>(`/api/exams/${exam.id}`, {
        method: "PATCH", body: JSON.stringify({ officialFormat: format })
      });
      onSaved(updated.officialFormat ?? null);
      if (!format) { setQuestions(""); setMinutes(""); setPass(""); }
      setStatus({ kind: "saved" });
      questionBankChanged();
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof ApiError ? err.message : "Could not save the exam format." });
    }
  };

  return (
    <div className="admin-panel-card" aria-labelledby={`${id}-title`}>
      <div style={{ marginBottom: 13 }}>
        <span id={`${id}-title`} className="admin-panel-kicker">Official exam format</span>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--color-text-muted)" }}>
          The real test's length, time limit and pass mark. Mock exams offer full, half and sprint lengths from it, and pass at the same share of correct answers.
          {exam.passMarkPct != null && ` It replaces the ${exam.passMarkPct}% pass mark once set.`}
        </p>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); if (!problem) void save({ questionCount: q, timeLimitMinutes: m, passCorrectCount: p }); }}
        style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}
      >
        <div className="field" style={{ flex: "1 1 140px" }}>
          <label htmlFor={`${id}-q`}>Questions</label>
          <input id={`${id}-q`} className="input" type="number" min={1} max={200} inputMode="numeric" value={questions} onChange={(e) => { setQuestions(e.target.value); setStatus({ kind: "idle" }); }} />
        </div>
        <div className="field" style={{ flex: "1 1 140px" }}>
          <label htmlFor={`${id}-m`}>Time limit (minutes)</label>
          <input id={`${id}-m`} className="input" type="number" min={1} max={600} inputMode="numeric" value={minutes} onChange={(e) => { setMinutes(e.target.value); setStatus({ kind: "idle" }); }} />
        </div>
        <div className="field" style={{ flex: "1 1 140px" }}>
          <label htmlFor={`${id}-p`}>Correct answers to pass</label>
          <input id={`${id}-p`} className="input" type="number" min={1} max={200} inputMode="numeric" value={pass} onChange={(e) => { setPass(e.target.value); setStatus({ kind: "idle" }); }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={!!problem || !dirty || status.kind === "saving"}>Save format</button>
          {saved && <button type="button" className="btn btn-secondary" disabled={status.kind === "saving"} onClick={() => void save(null)}>Clear</button>}
        </div>
      </form>
      <p role="status" style={{ margin: "10px 0 0", fontSize: 12.5, color: status.kind === "error" ? DANGER : "var(--color-text-muted)" }}>
        {status.kind === "error" ? status.message
          : status.kind === "saved" ? "Saved."
          : questions || minutes || pass ? (problem ?? (whole(q) ? `Pass mark ${Math.round((100 * p) / q)}% · ${(m / q).toFixed(1)} min per question.` : ""))
          : "Not set — mock exams offer sprint and custom lengths only."}
      </p>
    </div>
  );
}
