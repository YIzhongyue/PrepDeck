import { useEffect, useState } from "react";
import type { AdminOverviewResponse } from "@prepdeck/shared";
import { AdminIcon } from "../../components/AdminModal";
import { apiFetch, ApiError } from "../../lib/api";
import { type Tab, DANGER, countOf } from "./shared";

// The admin console's Overview tab and the header status pill fed by the same request.

// An overview that took longer than this is reported as slow.
const SLOW_OVERVIEW_MS = 3000;

// The header's status pill reports the last overview request: that request
// runs the console's D1 queries, so it is a real (if narrow) signal, where the
// pill used to say "System operational" whatever happened (issue #49).
type OverviewHealth =
  | { kind: "checking" }
  | { kind: "ok"; slow: boolean; at: Date }
  | { kind: "failed"; message: string };

export function useAdminOverview(enabled: boolean) {
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [health, setHealth] = useState<OverviewHealth>({ kind: "checking" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const started = performance.now();
    setHealth({ kind: "checking" });
    apiFetch<AdminOverviewResponse>("/api/admin/overview")
      .then((next) => {
        if (cancelled) return;
        setData(next);
        setHealth({ kind: "ok", slow: performance.now() - started > SLOW_OVERVIEW_MS, at: new Date() });
      })
      .catch((error) => {
        if (!cancelled) setHealth({ kind: "failed", message: error instanceof ApiError ? error.message : "The request did not complete." });
      });
    return () => { cancelled = true; };
  }, [enabled, attempt]);
  return { data, health, retry: () => setAttempt((n) => n + 1) };
}

export function StatusPill({ health }: { health: OverviewHealth }) {
  const [label, tone, detail] =
    health.kind === "checking" ? ["Checking status…", "checking", "Loading the admin overview."]
    : health.kind === "failed" ? ["Status unavailable", "down", `The admin overview failed to load: ${health.message}`]
    : health.slow ? ["Slow to respond", "slow", `The admin overview took more than ${SLOW_OVERVIEW_MS / 1000} s (${health.at.toLocaleTimeString()}).`]
    : ["Operational", "ok", `The admin overview loaded at ${health.at.toLocaleTimeString()}.`];
  return (
    <div className={`admin-status-pill is-${tone}`} role="status" title={detail}>
      <span className="admin-live-dot" aria-hidden="true" /> {label}
      <span className="sr-only">. {detail}</span>
    </div>
  );
}

// FR-13.4: at-a-glance usage counts, sourced from GET /api/admin/overview.
export function OverviewPanel({ data, health, onRetry, onNavigate }: {
  data: AdminOverviewResponse | null;
  health: OverviewHealth;
  onRetry: () => void;
  onNavigate: (tab: Tab) => void;
}) {
  if (health.kind === "failed") {
    return (
      <p style={{ fontSize: 13, color: DANGER, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        Could not load the overview.
        <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>
      </p>
    );
  }
  if (!data) return <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>;

  const stat = (label: string, value: number, tone: string, note: string) => (
    <div key={label} className={`admin-stat admin-stat-${tone}`}>
      <div className="admin-stat-top"><span>{label}</span><i /></div>
      <strong>{value.toLocaleString()}</strong>
      <small>{note}</small>
    </div>
  );

  const maxQuestions = Math.max(...data.questions.byExam.map((row) => row.questionCount), 1);

  return (
    <div className="admin-overview">
      <div className="admin-section-heading"><div><span>At a glance</span><h2>Workspace overview</h2></div><p>Live totals across your PrepDeck workspace.</p></div>
      <div className="admin-stat-grid">
        {stat("Active learners", data.users.active, "blue", `${data.users.total.toLocaleString()} authorized total`)}
        {stat("Question library", data.questions.total, "violet", `Across ${countOf(data.exams.total, "exam")}`)}
        {stat("Attempts recorded", data.attempts.total, "green", "All-time activity")}
        {stat("Pending invites", data.users.invited, "amber", `${data.users.revoked} access revoked`)}
      </div>
      <div className="admin-overview-grid">
      <div className="admin-panel">
        <div className="admin-panel-head"><div><span className="admin-panel-kicker">Content coverage</span><h3>Questions by exam</h3></div><button type="button" onClick={() => onNavigate("exams")}>Manage content <AdminIcon name="arrow" /></button></div>
        {data.questions.byExam.length === 0 && <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>No exams yet.</p>}
        {data.questions.byExam.map((row) => (
          <div key={row.examId} className="admin-coverage-row">
            <div><span>{row.examName}</span><strong>{row.questionCount}</strong></div>
            <div className="admin-progress"><i style={{ width: `${(row.questionCount / maxQuestions) * 100}%` }} /></div>
          </div>
        ))}
      </div>
      <aside className="admin-panel admin-quick-panel">
        <span className="admin-panel-kicker">Quick actions</span><h3>What would you like to do?</h3>
        <button type="button" onClick={() => onNavigate("users")}><span><AdminIcon name="users" /></span><div><strong>Invite a teammate</strong><small>Grant workspace access</small></div><AdminIcon name="arrow" /></button>
        <button type="button" onClick={() => onNavigate("exams")}><span><AdminIcon name="exams" /></span><div><strong>Add an exam</strong><small>Grow the content library</small></div><AdminIcon name="arrow" /></button>
      </aside>
      </div>
    </div>
  );
}
