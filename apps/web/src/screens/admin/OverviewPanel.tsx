import { useEffect, useState } from "react";
import type { AdminOverviewResponse } from "@prepdeck/shared";
import { AdminIcon } from "../../components/AdminModal";
import { apiFetch, ApiError } from "../../lib/api";
import { type Tab, DANGER, countOf } from "./shared";
import { formatNumber, formatTime, t as translate, useI18n } from "../../i18n";

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
        if (!cancelled) setHealth({ kind: "failed", message: error instanceof ApiError ? error.message : translate("admin.overview.requestFailed") });
      });
    return () => { cancelled = true; };
  }, [enabled, attempt]);
  return { data, health, retry: () => setAttempt((n) => n + 1) };
}

export function StatusPill({ health }: { health: OverviewHealth }) {
  const { t } = useI18n();
  const [label, tone, detail] =
    health.kind === "checking" ? [t("admin.status.checking"), "checking", t("admin.status.checkingDetail")]
    : health.kind === "failed" ? [t("admin.status.unavailable"), "down", t("admin.status.failedDetail", { message: health.message })]
    : health.slow ? [t("admin.status.slow"), "slow", t("admin.status.slowDetail", { seconds: SLOW_OVERVIEW_MS / 1000, time: formatTime(health.at) })]
    : [t("admin.status.ok"), "ok", t("admin.status.okDetail", { time: formatTime(health.at) })];
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
  const { t } = useI18n();
  if (health.kind === "failed") {
    return (
      <p style={{ fontSize: 13, color: DANGER, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        {t("admin.overview.loadFailed")}
        <button type="button" className="btn btn-secondary" onClick={onRetry}>{t("common.retry")}</button>
      </p>
    );
  }
  if (!data) return <p style={{ fontSize: 13, opacity: 0.7 }}>{t("common.loading")}</p>;

  const stat = (label: string, value: number, tone: string, note: string) => (
    <div key={label} className={`admin-stat admin-stat-${tone}`}>
      <div className="admin-stat-top"><span>{label}</span><i /></div>
      <strong>{formatNumber(value)}</strong>
      <small>{note}</small>
    </div>
  );

  const maxQuestions = Math.max(...data.questions.byExam.map((row) => row.questionCount), 1);

  return (
    <div className="admin-overview">
      <div className="admin-section-heading"><div><span>{t("admin.overview.kicker")}</span><h2>{t("admin.overview.title")}</h2></div><p>{t("admin.overview.intro")}</p></div>
      <div className="admin-stat-grid">
        {stat(t("admin.overview.activeLearners"), data.users.active, "blue", t("admin.overview.authorizedTotal", { count: data.users.total }))}
        {stat(t("admin.overview.library"), data.questions.total, "violet", t("admin.overview.across", { exams: countOf(data.exams.total, "exam") }))}
        {stat(t("admin.overview.attempts"), data.attempts.total, "green", t("admin.overview.allTime"))}
        {stat(t("admin.overview.invites"), data.users.invited, "amber", t("admin.overview.revoked", { count: data.users.revoked }))}
      </div>
      <div className="admin-overview-grid">
      <div className="admin-panel">
        <div className="admin-panel-head"><div><span className="admin-panel-kicker">{t("admin.overview.coverage")}</span><h3>{t("admin.overview.byExam")}</h3></div><button type="button" onClick={() => onNavigate("exams")}>{t("admin.overview.manageContent")} <AdminIcon name="arrow" /></button></div>
        {data.questions.byExam.length === 0 && <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>{t("admin.overview.noExams")}</p>}
        {data.questions.byExam.map((row) => (
          <div key={row.examId} className="admin-coverage-row">
            <div><span>{row.examName}</span><strong>{row.questionCount}</strong></div>
            <div className="admin-progress"><i style={{ width: `${(row.questionCount / maxQuestions) * 100}%` }} /></div>
          </div>
        ))}
      </div>
      <aside className="admin-panel admin-quick-panel">
        <span className="admin-panel-kicker">{t("admin.overview.quick")}</span><h3>{t("admin.overview.quickTitle")}</h3>
        <button type="button" onClick={() => onNavigate("users")}><span><AdminIcon name="users" /></span><div><strong>{t("admin.overview.invite")}</strong><small>{t("admin.overview.inviteDesc")}</small></div><AdminIcon name="arrow" /></button>
        <button type="button" onClick={() => onNavigate("exams")}><span><AdminIcon name="exams" /></span><div><strong>{t("admin.overview.addExam")}</strong><small>{t("admin.overview.addExamDesc")}</small></div><AdminIcon name="arrow" /></button>
      </aside>
      </div>
    </div>
  );
}
