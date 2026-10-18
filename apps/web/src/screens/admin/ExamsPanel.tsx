import { useEffect, useState } from "react";
import type { OfficialMockFormat, Provider } from "@prepdeck/shared";
import { AdminIcon, AdminModal } from "../../components/AdminModal";
import ProviderManager from "../../components/ProviderManager";
import QuestionsPanel from "../../components/QuestionsPanel";
import { apiFetch, ApiError } from "../../lib/api";
import { examListChanged } from "../../lib/questionAuthoring";
import { ExamMetadataModal, OfficialFormatCard } from "./ExamSettings";
import { type ExamRow, DANGER, countOf } from "./shared";

// FR-2.1/FR-2.3/FR-2.4 (docs/requirements/question-bank-management.md) surfaced under the /admin console per
// FR-13.3: exam create/archive, and per-exam question view/edit/delete.
export function ExamsPanel({ onCount }: { onCount: (n: number) => void }) {
  const [exams, setExams] = useState<ExamRow[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState<string>("all");
  const [modal, setModal] = useState<"exam" | "provider" | "providers" | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [subject, setSubject] = useState("");
  const [language, setLanguage] = useState("");
  const [badgeIcon, setBadgeIcon] = useState<File | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [providerLoadError, setProviderLoadError] = useState<string | null>(null);

  useEffect(() => {
    const loadExams = () => apiFetch<{ exams: ExamRow[] }>("/api/exams?includeArchived=true")
      .then(({ exams }) => setExams(exams))
      .catch(() => setLoadError("Could not load exams."))
      .finally(() => setLoading(false));
    loadExams();
    window.addEventListener("prepdeck:question-bank-changed", loadExams);
    return () => window.removeEventListener("prepdeck:question-bank-changed", loadExams);
  }, []);

  useEffect(() => {
    apiFetch<{ providers: Provider[] }>("/api/providers?includeArchived=true")
      .then(({ providers }) => setProviders(providers))
      .catch(() => setProviderLoadError("Could not load providers. Reopen Content to retry."));
  }, []);

  useEffect(() => { onCount(exams.length); }, [exams.length, onCount]);

  const updateProvider = (provider: Provider) => {
    setProviders((current) => [...current.filter((p) => p.id !== provider.id), provider].sort((a, b) => a.name.localeCompare(b.name)));
    setExams((current) => current.map((exam) => ({ ...exam, providers: exam.providers.map((p) => p.id === provider.id ? provider : p) })));
    if (provider.archivedAt) setProviderFilter((current) => current === provider.id ? "all" : current);
    examListChanged();
  };
  const deleteProvider = (id: string) => {
    setProviders((current) => current.filter((p) => p.id !== id));
    setProviderFilter((current) => current === id ? "all" : current);
    examListChanged();
  };
  const providerDialog = (modal === "provider" || modal === "providers") && (
    <ProviderManager mode={modal === "provider" ? "new" : "manage"} providers={providers}
      onChange={updateProvider} onDelete={deleteProvider} onClose={() => setModal(null)} />
  );

  const setProviderExam = async (provider: Provider, exam: ExamRow, assigned: boolean) => {
    try {
      await apiFetch(`/api/providers/${provider.id}/exams/${exam.id}`, { method: assigned ? "PUT" : "DELETE" });
      setExams((current) => current.map((item) => item.id !== exam.id ? item : { ...item, providers: assigned ? [...item.providers, provider] : item.providers.filter((p) => p.id !== provider.id) }));
      examListChanged();
    } catch (err) { window.alert(err instanceof ApiError ? err.message : "Could not update provider assignment."); }
  };

  const uploadBadge = async (examId: string, file: File) => {
    return apiFetch<{ badgeIconUrl: string }>(`/api/exams/${examId}/badge`, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file
    });
  };

  const createExam = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    if (!name.trim() || !slug.trim()) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const { exam } = await apiFetch<{ exam: ExamRow }>("/api/exams", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), slug: slug.trim(), subject: subject.trim() || undefined, language: language.trim() || undefined })
      });
      let created = exam;
      if (badgeIcon) {
        try {
          const { badgeIconUrl } = await uploadBadge(exam.id, badgeIcon);
          created = { ...created, badgeIconUrl };
        } catch (err) {
          setCreateError(`Exam created, but its badge could not be uploaded: ${err instanceof ApiError ? err.message : "upload failed"}`);
        }
      }
      setExams((prev) => prev.concat(created));
      setName("");
      setSlug("");
      setSubject("");
      setLanguage("");
      setBadgeIcon(null);
      form.reset();
      if (!createError) setModal(null);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create this exam.");
    } finally {
      setCreateBusy(false);
    }
  };

  const toggleArchive = (exam: ExamRow) => {
    const action = exam.archivedAt ? "unarchive" : "archive";
    if (action === "archive" && !window.confirm(`Archive "${exam.name}"? It will be hidden from practice/mock setup for all users.`)) return;
    apiFetch<{ archivedAt: string | null }>(`/api/exams/${exam.id}/${action}`, { method: "POST" })
      .then(({ archivedAt }) => setExams((prev) => prev.map((x) => (x.id === exam.id ? { ...x, archivedAt } : x))))
      .catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update this exam."));
  };

  const replaceBadge = (exam: ExamRow, file: File) => {
    uploadBadge(exam.id, file)
      .then(({ badgeIconUrl }) => setExams((prev) => prev.map((x) => x.id === exam.id ? { ...x, badgeIconUrl } : x)))
      .catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not upload this badge icon."));
  };

  const selected = exams.find((e) => e.id === selectedExamId) ?? null;

  if (selected) {
    return (
      <>
      {providerLoadError && <p role="alert" style={{ color: DANGER }}>{providerLoadError}</p>}
      <ExamDetail
        exam={selected}
        providers={providers}
        onBack={() => setSelectedExamId(null)}
        onToggleProvider={setProviderExam}
        onNewProvider={() => setModal("provider")}
        onManageProviders={() => setModal("providers")}
        onToggleArchive={toggleArchive}
        onReplaceBadge={replaceBadge}
        onFormatSaved={(officialFormat) => setExams((prev) => prev.map((x) => x.id === selected.id ? { ...x, officialFormat } : x))}
        onMetadataSaved={(updated) => {
          setExams((prev) => prev.map((x) => x.id === updated.id ? { ...x, ...updated } : x));
          // The sidebar's exam picker and exam URLs carry the name and slug.
          examListChanged();
        }}
      />
      {providerDialog}
      </>
    );
  }

  // Group by the first active provider: archived providers have no filter
  // pill, so an exam linked only to archived providers belongs under "Other".
  const primaryProvider = (ex: ExamRow) => ex.providers.find((p) => !p.archivedAt);
  const groupKey = (ex: ExamRow) => primaryProvider(ex)?.id ?? "__other__";
  const groupLabel = (ex: ExamRow) => primaryProvider(ex)?.name ?? "Other";
  const hasOther = exams.some((ex) => !primaryProvider(ex));
  const q = search.trim().toLowerCase();

  const filtered = exams.filter((ex) => {
    if (providerFilter !== "all" && groupKey(ex) !== providerFilter) return false;
    if (q && !ex.name.toLowerCase().includes(q) && !ex.slug.toLowerCase().includes(q)) return false;
    return true;
  });

  const groups: { key: string; label: string; exams: ExamRow[] }[] = [];
  filtered.forEach((ex) => {
    const key = groupKey(ex);
    let g = groups.find((x) => x.key === key);
    if (!g) { g = { key, label: groupLabel(ex), exams: [] }; groups.push(g); }
    g.exams.push(ex);
  });
  groups.sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="admin-toolbar">
        <label className="admin-search" style={{ maxWidth: 280 }}>
          <AdminIcon name="search" />
          <span className="sr-only">Search exams</span>
          <input placeholder="Search exams…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button type="button" className={providerFilter === "all" ? "admin-provider-pill is-active" : "admin-provider-pill"} onClick={() => setProviderFilter("all")}>All providers</button>
          {providers.filter((p) => !p.archivedAt).map((p) => (
            <button key={p.id} type="button" className={providerFilter === p.id ? "admin-provider-pill is-active" : "admin-provider-pill"} onClick={() => setProviderFilter(p.id)}>{p.shortName || p.name}</button>
          ))}
          {hasOther && <button type="button" className={providerFilter === "__other__" ? "admin-provider-pill is-active" : "admin-provider-pill"} onClick={() => setProviderFilter("__other__")}>Other</button>}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" onClick={() => setModal("providers")}>Manage providers</button>
          <button type="button" className="btn btn-secondary" onClick={() => setModal("provider")}>New provider</button>
          <button type="button" className="btn btn-primary" onClick={() => setModal("exam")}><AdminIcon name="plus" /> New exam</button>
        </div>
      </div>

      {providerLoadError && <p role="alert" style={{ color: DANGER }}>{providerLoadError}</p>}
      {loadError && <p style={{ fontSize: 13, color: DANGER }}>{loadError}</p>}
      {loading && !loadError && <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>}

      {!loading && !loadError && (
        <>
          {groups.map((g) => (
            <div key={g.key} className="admin-provider-group">
              <div className="admin-provider-group-head">
                <span>{g.label}</span>
                <span className="admin-provider-group-rule" />
                <span>{countOf(g.exams.length, "exam")}</span>
              </div>
              <div className="admin-exam-grid">
                {g.exams.map((ex) => (
                  <button key={ex.id} type="button" className={ex.archivedAt ? "admin-exam-card is-archived" : "admin-exam-card"} onClick={() => setSelectedExamId(ex.id)}>
                    <span style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <span className="admin-exam-badge">
                        {ex.badgeIconUrl ? <img src={ex.badgeIconUrl} alt="" /> : (primaryProvider(ex)?.shortName ?? ex.slug.slice(0, 3).toUpperCase())}
                      </span>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <span className="admin-exam-name">{ex.name}</span>
                        <span className="admin-exam-slug">{ex.slug}</span>
                      </span>
                      <span className={`tag ${ex.archivedAt ? "tag-neutral" : "tag-accent-2"}`} style={{ flex: "none" }}>{ex.archivedAt ? "archived" : "active"}</span>
                    </span>
                    <span className="admin-exam-card-foot">
                      <span>
                        <strong>{ex.questionCount}</strong>
                        <small>questions</small>
                      </span>
                      <span className="admin-exam-open">Open <AdminIcon name="arrow" /></span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {groups.length === 0 && <p style={{ fontSize: 13, opacity: 0.7 }}>No exams match.</p>}
        </>
      )}

      {providerDialog}

      {modal === "exam" && (
        <AdminModal icon="exams" title="New exam" subtitle="The slug is used in imports and URLs — keep it stable." onClose={() => setModal(null)}>
          <form onSubmit={createExam} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="admin-modal-fields">
              <div className="field" style={{ flex: "1 1 100%" }}><label>Name</label><input className="input" placeholder="AWS SAP-C02" value={name} onChange={(e) => setName(e.target.value)} required /></div>
              <div className="field" style={{ flex: "1 1 180px" }}><label>Slug</label><input className="input" placeholder="aws-sap-c02" value={slug} onChange={(e) => setSlug(e.target.value)} required /></div>
              <div className="field" style={{ flex: "1 1 160px" }}><label>Subject</label><input className="input" placeholder="Architecture" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
              <div className="field" style={{ flex: "0 1 110px" }}><label>Language</label><input className="input" placeholder="en" value={language} onChange={(e) => setLanguage(e.target.value)} /></div>
              <div className="field" style={{ flex: "1 1 100%" }}>
                <label>Badge icon</label>
                <div className="admin-modal-file">
                  <span>square PNG / SVG</span>
                  <label>{badgeIcon ? badgeIcon.name : "Browse"}<input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => setBadgeIcon(e.target.files?.[0] ?? null)} /></label>
                </div>
              </div>
            </div>
            {createError && <p style={{ margin: 0, fontSize: 12, color: DANGER }}>{createError}</p>}
            <div className="admin-modal-foot">
              <p>You can add questions right after.</p>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={createBusy || !name.trim() || !slug.trim()}>{createBusy ? "Creating…" : "Create exam"}</button>
            </div>
          </form>
        </AdminModal>
      )}
    </div>
  );
}

function ExamDetail({
  exam, providers, onBack, onToggleProvider, onNewProvider, onManageProviders, onToggleArchive, onReplaceBadge, onFormatSaved, onMetadataSaved
}: {
  exam: ExamRow;
  providers: Provider[];
  onBack: () => void;
  onToggleProvider: (provider: Provider, exam: ExamRow, assigned: boolean) => void;
  onNewProvider: () => void;
  onManageProviders: () => void;
  onToggleArchive: (exam: ExamRow) => void;
  onReplaceBadge: (exam: ExamRow, file: File) => void;
  onFormatSaved: (format: OfficialMockFormat | null) => void;
  onMetadataSaved: (exam: ExamRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div style={{ marginTop: 6 }}>
      <button type="button" className="admin-back-link" onClick={onBack}><AdminIcon name="back" /> All exams</button>

      <div className="admin-detail-head">
        <span className="admin-detail-badge">{exam.badgeIconUrl ? <img src={exam.badgeIconUrl} alt="" /> : "badge"}</span>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <h2 style={{ margin: 0, fontSize: 26, lineHeight: 1.15 }}>{exam.name}</h2>
            <span className={`tag ${exam.archivedAt ? "tag-neutral" : "tag-accent-2"}`}>{exam.archivedAt ? "archived" : "active"}</span>
          </div>
          <div className="admin-detail-meta">
            <span className="mono">{exam.slug}</span>
            <span>{countOf(exam.questionCount, "question")}</span>
            <span>Subject · {exam.subject || "—"}</span>
            <span>Language · {exam.language || "—"}</span>
            {exam.passMarkPct != null && <span>Pass mark · {exam.passMarkPct}%</span>}
          </div>
          {exam.description && <p className="admin-detail-description">{exam.description}</p>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>Edit details</button>
          <label className="btn btn-secondary" style={{ cursor: "pointer" }}>
            {exam.badgeIconUrl ? "Replace badge" : "Add badge"}
            <input type="file" hidden accept="image/jpeg,image/png,image/webp" onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onReplaceBadge(exam, file);
              e.target.value = "";
            }} />
          </label>
          <button type="button" className="btn btn-secondary" onClick={() => onToggleArchive(exam)}>{exam.archivedAt ? "Unarchive" : "Archive"}</button>
        </div>
      </div>

      <div className="admin-panel-card">
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 13 }}>
          <div>
            <span className="admin-panel-kicker">Providers</span>
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--color-text-muted)" }}>Tap to assign or unassign this exam.</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-ghost" onClick={onManageProviders}>Manage providers</button>
            <button type="button" className="btn btn-ghost" onClick={onNewProvider}>New provider</button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {providers.filter((p) => !p.archivedAt || exam.providers.some((assigned) => assigned.id === p.id)).map((p) => {
            const on = exam.providers.some((x) => x.id === p.id);
            return (
              <button key={p.id} type="button" className={on ? "admin-provider-toggle is-on" : "admin-provider-toggle"} aria-pressed={on} onClick={() => onToggleProvider(p, exam, !on)}>
                <span className="tick" aria-hidden="true">✓</span>{p.name}{p.archivedAt ? " (archived)" : ""}
              </button>
            );
          })}
          {providers.length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-text-muted)" }}>No providers yet.</p>}
        </div>
      </div>

      <OfficialFormatCard key={exam.id} exam={exam} onSaved={onFormatSaved} />

      <QuestionsPanel exam={exam} />

      {editing && (
        <ExamMetadataModal exam={exam} onClose={() => setEditing(false)}
          onSaved={(updated) => { onMetadataSaved(updated); setEditing(false); }} />
      )}
    </div>
  );
}
