import { useId, useState } from "react";
import { EXAM_SLUG_PATTERN, type Exam, type OfficialMockFormat } from "@prepdeck/shared";
import { AdminModal } from "../../components/AdminModal";
import { apiFetch, ApiError } from "../../lib/api";
import { questionBankChanged } from "../../lib/questionAuthoring";
import { type ExamRow, DANGER } from "./shared";
import { useI18n } from "../../i18n";

// Per-exam settings edited from the Content tab's exam detail.

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
  const { t, rich } = useI18n();

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

  const problem = !name.trim() ? t("admin.examSettings.nameRequired")
    : !EXAM_SLUG_PATTERN.test(slug.trim()) ? t("admin.examSettings.slugInvalid")
    : pct != null && !(pct >= 0 && pct <= 100) ? t("admin.examSettings.passInvalid")
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
      setError(err instanceof ApiError ? err.message : t("admin.examSettings.saveFailed"));
      setBusy(false);
    }
  };

  return (
    <AdminModal icon="exams" title={t("admin.examSettings.title")} subtitle={t("admin.examSettings.subtitle")} closeDisabled={busy} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={save} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div className="admin-modal-fields">
          <div className="field" style={{ flex: "1 1 100%" }}>
            <label htmlFor={`${id}-name`}>{t("admin.exams.name")}</label>
            <input id={`${id}-name`} className="input" value={name} onChange={edit(setName)} maxLength={200} required />
          </div>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor={`${id}-slug`}>{t("admin.exams.slug")}</label>
            <input id={`${id}-slug`} className="input" value={slug} onChange={(e) => { edit(setSlug)(e); setSlugConfirmed(false); }} autoCapitalize="off" spellCheck={false} required />
          </div>
          <div className="field" style={{ flex: "1 1 160px" }}>
            <label htmlFor={`${id}-subject`}>{t("admin.exams.subject")}</label>
            <input id={`${id}-subject`} className="input" value={subject} onChange={edit(setSubject)} maxLength={200} />
          </div>
          <div className="field" style={{ flex: "0 1 110px" }}>
            <label htmlFor={`${id}-language`}>{t("admin.exams.language")}</label>
            <input id={`${id}-language`} className="input" value={language} onChange={edit(setLanguage)} maxLength={50} />
          </div>
          <div className="field" style={{ flex: "1 1 100%" }}>
            <label htmlFor={`${id}-description`}>{t("admin.examSettings.description")}</label>
            <textarea id={`${id}-description`} className="input" rows={3} value={description} onChange={edit(setDescription)} maxLength={2000} />
          </div>
          <div className="field" style={{ flex: "1 1 100%" }}>
            <label htmlFor={`${id}-pass`}>{t("admin.examSettings.passMark")}</label>
            <input id={`${id}-pass`} className="input" type="number" min={0} max={100} step="any" inputMode="decimal" value={passMark} onChange={edit(setPassMark)} style={{ maxWidth: 140 }} />
            <p className="admin-modal-hint">
              {t(exam.officialFormat ? "admin.examSettings.passUnused" : "admin.examSettings.passHint")}
            </p>
          </div>
        </div>

        {slugChanged && !problem && (
          <div className="admin-modal-warning">
            <p>
              {rich("admin.examSettings.slugWarning", { slug: (chunks) => <span className="mono">{chunks}</span>, old: exam.slug })}
            </p>
            <label>
              <input type="checkbox" checked={slugConfirmed} onChange={(e) => setSlugConfirmed(e.target.checked)} />
              <span>{rich("admin.examSettings.slugConfirm", { slug: (chunks) => <span className="mono">{chunks}</span>, next: slug.trim() })}</span>
            </label>
          </div>
        )}

        {(error || problem) && <p role="alert" style={{ margin: 0, fontSize: 12, color: DANGER }}>{error ?? problem}</p>}
        <div className="admin-modal-foot">
          <p>{t(dirty ? "admin.examSettings.onlyChanged" : "admin.examSettings.noChanges")}</p>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={onClose}>{t("common.cancel")}</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !dirty || !!problem || (slugChanged && !slugConfirmed)}>{busy ? t("common.saving") : t("admin.examSettings.save")}</button>
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
  const { t } = useI18n();

  const q = Number(questions), m = Number(minutes), p = Number(pass);
  const whole = (n: number) => Number.isInteger(n) && n > 0;
  const problem = !questions || !minutes || !pass ? t("admin.format.fillAll")
    : !whole(q) || !whole(m) || !whole(p) ? t("admin.format.wholeNumbers")
    : p > q ? t("admin.format.passTooHigh")
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
      setStatus({ kind: "error", message: err instanceof ApiError ? err.message : t("admin.format.saveFailed") });
    }
  };

  return (
    <div className="admin-panel-card" aria-labelledby={`${id}-title`}>
      <div style={{ marginBottom: 13 }}>
        <span id={`${id}-title`} className="admin-panel-kicker">{t("admin.format.title")}</span>
        <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--color-text-muted)" }}>
          {t("admin.format.intro")}
          {exam.passMarkPct != null && ` ${t("admin.format.replacesPass", { pass: exam.passMarkPct })}`}
        </p>
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); if (!problem) void save({ questionCount: q, timeLimitMinutes: m, passCorrectCount: p }); }}
        style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: 12 }}
      >
        <div className="field" style={{ flex: "1 1 140px" }}>
          <label htmlFor={`${id}-q`}>{t("setup.summary.questions")}</label>
          <input id={`${id}-q`} className="input" type="number" min={1} max={200} inputMode="numeric" value={questions} onChange={(e) => { setQuestions(e.target.value); setStatus({ kind: "idle" }); }} />
        </div>
        <div className="field" style={{ flex: "1 1 140px" }}>
          <label htmlFor={`${id}-m`}>{t("mock.setup.timeLimit")}</label>
          <input id={`${id}-m`} className="input" type="number" min={1} max={600} inputMode="numeric" value={minutes} onChange={(e) => { setMinutes(e.target.value); setStatus({ kind: "idle" }); }} />
        </div>
        <div className="field" style={{ flex: "1 1 140px" }}>
          <label htmlFor={`${id}-p`}>{t("admin.format.passCount")}</label>
          <input id={`${id}-p`} className="input" type="number" min={1} max={200} inputMode="numeric" value={pass} onChange={(e) => { setPass(e.target.value); setStatus({ kind: "idle" }); }} />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={!!problem || !dirty || status.kind === "saving"}>{t("admin.format.save")}</button>
          {saved && <button type="button" className="btn btn-secondary" disabled={status.kind === "saving"} onClick={() => void save(null)}>{t("common.clear")}</button>}
        </div>
      </form>
      <p role="status" style={{ margin: "10px 0 0", fontSize: 12.5, color: status.kind === "error" ? DANGER : "var(--color-text-muted)" }}>
        {status.kind === "error" ? status.message
          : status.kind === "saved" ? t("admin.format.saved")
          : questions || minutes || pass ? (problem ?? (whole(q) ? t("admin.format.summary", { pass: Math.round((100 * p) / q), minutes: (m / q).toFixed(1) }) : ""))
          : t("admin.format.notSet")}
      </p>
    </div>
  );
}
