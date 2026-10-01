import { useEffect, useId, useState } from "react";
import type {
  AdminOverviewResponse,
  AdminUsersListResponse,
  Exam,
  InviteUserResponse,
  OfficialMockFormat,
  Provider,
  Role,
  UpdateUserResponse,
  User,
  UserStatus
} from "@prepdeck/shared";
import { AdminIcon, AdminModal } from "../components/AdminModal";
import ProviderManager from "../components/ProviderManager";
import MascotSettingsPanel from "../components/MascotSettingsPanel";
import QuestionsPanel from "../components/QuestionsPanel";
import McpTokensCard from "../components/McpTokensCard";
import { apiFetch, ApiError } from "../lib/api";
import { examListChanged, questionBankChanged } from "../lib/questionAuthoring";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { Breakpoints } from "../lib/responsive";

type Tab = "overview" | "users" | "exams" | "mcp" | "appearance";
interface ExamRow extends Exam {
  questionCount: number;
}

const DANGER = "var(--color-danger, #c0392b)";

// "1 exam", "2 exams": every count the console prints goes through this.
function countOf(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : plural}`;
}

// An overview that took longer than this is reported as slow.
const SLOW_OVERVIEW_MS = 3000;

// The header's status pill reports the last overview request: that request
// runs the console's D1 queries, so it is a real (if narrow) signal, where the
// pill used to say "System operational" whatever happened (issue #49).
type OverviewHealth =
  | { kind: "checking" }
  | { kind: "ok"; slow: boolean; at: Date }
  | { kind: "failed"; message: string };

function useAdminOverview(enabled: boolean) {
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

function StatusPill({ health }: { health: OverviewHealth }) {
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

function initials(source: string): string {
  const cleaned = source.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("");
  return (cleaned || source.slice(0, 2)).toUpperCase();
}

// docs/requirements/question-bank-management.md — the `/admin` console. Navigation here is this app's
// internal `screen` state machine (there is no URL router elsewhere in the
// app either), so this component *is* the route: FR-13.1 keeps its nav
// entry hidden from non-admins (Sidebar/TabBar), and the guard below is the
// state-machine equivalent of FR-13.2's redirect for anyone who still lands
// here. Every mutating call below is independently re-checked server-side
// (requireAdmin) regardless of this guard, per FR-1.6/FR-1.7.
export default function Admin({ bp: _bp }: { bp: Breakpoints }) {
  const { state, go } = usePrepDeck();
  const [tab, setTab] = useState<Tab>("overview");
  const [userCount, setUserCount] = useState<number | null>(null);
  const [examCount, setExamCount] = useState<number | null>(null);
  const isAdmin = state.me?.role === "admin";
  // Fetched whenever Overview is shown, so its figures and the header's status
  // are both as fresh as the last visit.
  const overview = useAdminOverview(isAdmin && tab === "overview");

  useEffect(() => {
    if (state.me && !isAdmin) go("dash");
  }, [state.me, isAdmin, go]);

  if (!isAdmin || !state.me) return null;

  const tabs: { id: Tab; label: string; count: number | null }[] = [
    { id: "overview", label: "Overview", count: null },
    { id: "users", label: "People", count: userCount },
    { id: "exams", label: "Content", count: examCount },
    { id: "mcp", label: "MCP tokens", count: null },
    { id: "appearance", label: "Appearance", count: null }
  ];

  // `backwards`, not `both` — see the note on `@keyframes pd-rise` in app.css.
  return (
    <div className="admin-shell" style={{ animation: "pd-rise .28s ease backwards" }}>
      <header className="admin-header">
        <div className="admin-header-copy">
          <div className="admin-header-eyebrow"><span className="admin-header-eyebrow-icon"><AdminIcon name="shield" /></span> Admin workspace</div>
          <h1>Access &amp; content</h1>
          <p>Invite the people who study here, and keep the exam library tidy.</p>
        </div>
        <StatusPill health={overview.health} />
      </header>

      <nav className="admin-tabs" aria-label="Admin sections">
        {tabs.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              // A selected tab that sits past the edge of the scrolled row comes into view.
              onClick={(e) => { setTab(t.id); e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" }); }}
              className={on ? "admin-tab is-active" : "admin-tab"}
              aria-current={on ? "page" : undefined}
            >
              {t.label}
              {t.count !== null && <span className="admin-tab-badge">{t.count}</span>}
            </button>
          );
        })}
      </nav>

      <section className="admin-content">
      {tab === "overview" && <OverviewPanel data={overview.data} health={overview.health} onRetry={overview.retry} onNavigate={setTab} />}
      {tab === "users" && <UsersPanel myId={state.me.id} onCount={setUserCount} />}
      {tab === "exams" && <ExamsPanel onCount={setExamCount} />}
      {tab === "mcp" && <McpTokensPanel />}
      {tab === "appearance" && <MascotSettingsPanel />}
      </section>
    </div>
  );
}

// FR-13.4: at-a-glance usage counts, sourced from GET /api/admin/overview.
function OverviewPanel({ data, health, onRetry, onNavigate }: {
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

// implementation — Admin MCP tokens are personal access tokens bound to the
// signed-in admin's own account (see routes/mcpTokens.ts), so this reuses
// the exact same card as Settings' User MCP tokens, pointed at the
// admin-only /api/admin/mcp-tokens namespace.
function McpTokensPanel() {
  return (
    <McpTokensCard
      title="Admin MCP tokens"
      description="Privileged tokens for admin-side AI clients (e.g. local-codex, chatgpt-admin) that need question-bank management access. These are separate from, and cannot be used as, User MCP tokens."
      apiBase="/api/admin/mcp-tokens"
      namePlaceholder="e.g. local-codex"
    />
  );
}

const STATUS_COLOR: Record<UserStatus, string> = { active: "var(--color-accent-2)", invited: "var(--color-accent-600)", revoked: "var(--color-neutral-500)" };

// FR-1.2/FR-1.4 — Authorized Users: invite, change role, revoke/restore.
function UsersPanel({ myId, onCount }: { myId: string; onCount: (n: number) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [password, setPassword] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | UserStatus>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    apiFetch<AdminUsersListResponse>("/api/admin/users")
      .then(({ users }) => setUsers(users))
      .catch(() => setLoadError("Could not load the Authorized Users list."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { onCount(users.length); }, [users.length, onCount]);

  const invite = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setInviteBusy(true);
    setInviteError(null);
    apiFetch<InviteUserResponse>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email: trimmed, role, password: password.trim() || undefined })
    })
      .then(({ user }) => {
        setUsers((prev) => prev.concat(user));
        setEmail("");
        setPassword("");
        setRole("user");
        setInviteOpen(false);
      })
      .catch((err) => setInviteError(err instanceof ApiError ? err.message : "Could not invite this account."))
      .finally(() => setInviteBusy(false));
  };

  const updateUser = (id: string, patch: { role?: Role; status?: "active" | "revoked"; googleSub?: null }) => {
    return apiFetch<UpdateUserResponse>(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) })
      .then(({ user }) => {
        setUsers((prev) => prev.map((u) => (u.id === id ? user : u)));
        return user;
      });
  };

  const revoke = (u: User) => {
    if (!window.confirm(`Revoke access for ${u.email}? Historical data is kept; this can be undone with Restore.`)) return;
    updateUser(u.id, { status: "revoked" }).catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update this account."));
  };

  // FR-1.9: an account answers to the Google account that first signed into it,
  // not to its address, so a person whose Google account was replaced (a
  // Workspace migration onto a custom domain, say) is turned away rather than
  // silently adopting the existing data. Clearing the link lets the next
  // successful sign-in on this address claim the account — which is also
  // exactly why it is a deliberate Admin act with a warning, not automatic.
  const resetGoogleLink = (u: User) => {
    if (!window.confirm(`Reset the Google link for ${u.email}? The next Google account that signs in with this address takes over this account and all of its data. Only do this if you know the account changed hands legitimately.`)) return;
    updateUser(u.id, { googleSub: null }).catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update this account."));
  };

  const editableSelectedIds = selected.filter((id) => id !== myId);

  const bulkApply = (patch: { role?: Role; status?: "active" | "revoked" }) => {
    if (editableSelectedIds.length === 0) return;
    setBulkBusy(true);
    Promise.all(editableSelectedIds.map((id) => updateUser(id, patch)))
      .then(() => setSelected([]))
      .catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update the selected accounts."))
      .finally(() => setBulkBusy(false));
  };

  const bulkRevoke = () => {
    if (editableSelectedIds.length === 0) return;
    if (!window.confirm(`Revoke access for ${editableSelectedIds.length} account${editableSelectedIds.length === 1 ? "" : "s"}? This can be undone with Restore.`)) return;
    bulkApply({ status: "revoked" });
  };

  const counts: Record<"all" | UserStatus, number> = {
    all: users.length,
    active: users.filter((u) => u.status === "active").length,
    invited: users.filter((u) => u.status === "invited").length,
    revoked: users.filter((u) => u.status === "revoked").length
  };

  const byStatus = users.filter((u) => statusFilter === "all" || u.status === statusFilter);
  const visibleUsers = byStatus.filter((user) => user.email.toLowerCase().includes(search.trim().toLowerCase()));
  const allVisibleSelected = visibleUsers.length > 0 && visibleUsers.every((u) => selected.includes(u.id));

  const toggleAll = () => {
    setSelected((prev) => (
      allVisibleSelected
        ? prev.filter((id) => !visibleUsers.some((u) => u.id === id))
        : Array.from(new Set(prev.concat(visibleUsers.map((u) => u.id))))
    ));
  };
  const toggleOne = (id: string) => setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.concat(id)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div className="admin-toolbar">
        <label className="admin-search">
          <AdminIcon name="search" />
          <span className="sr-only">Search people</span>
          <input placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <div className="admin-filter-group">
          {(["all", "active", "invited", "revoked"] as const).map((id) => (
            <button
              key={id}
              type="button"
              className={statusFilter === id ? "admin-filter-pill is-active" : "admin-filter-pill"}
              onClick={() => { setStatusFilter(id); setSelected([]); }}
            >
              {id === "all" ? "All" : id.charAt(0).toUpperCase() + id.slice(1)} <span className="admin-filter-count">{counts[id]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-primary" style={{ marginLeft: "auto" }} onClick={() => setInviteOpen(true)}>
          <AdminIcon name="plus" /> Invite people
        </button>
      </div>

      {selected.length > 0 && (
        <div className="admin-bulk-bar">
          <strong>{selected.length} selected</strong>
          <span className="admin-bulk-divider" />
          <button type="button" className="btn btn-secondary" disabled={bulkBusy || editableSelectedIds.length === 0} onClick={() => bulkApply({ role: "admin" })}>Make admin</button>
          <button type="button" className="btn btn-secondary" disabled={bulkBusy || editableSelectedIds.length === 0} onClick={() => bulkApply({ role: "user" })}>Make user</button>
          <button type="button" className="btn btn-secondary" style={{ color: DANGER }} disabled={bulkBusy || editableSelectedIds.length === 0} onClick={bulkRevoke}>Revoke access</button>
          <button type="button" className="admin-bulk-clear" onClick={() => setSelected([])}>Clear</button>
        </div>
      )}

      <div className="card elev-sm" style={{ padding: 0, overflow: "hidden" }}>
        {loadError && <p style={{ margin: 0, padding: 20, fontSize: 13, color: DANGER }}>{loadError}</p>}
        {loading && !loadError && <p style={{ margin: 0, padding: 20, fontSize: 13, opacity: 0.7 }}>Loading…</p>}
        {!loading && !loadError && (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, minWidth: 800 }}>
              <thead>
                <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-divider)" }}>
                  <th style={{ padding: "11px 18px", width: 44 }}><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} style={{ width: 15, height: 15, accentColor: "var(--color-accent)", cursor: "pointer" }} /></th>
                  <th style={{ padding: "11px 18px" }}>Person</th>
                  <th style={{ padding: "11px 18px" }}>Role</th>
                  <th style={{ padding: "11px 18px" }}>Status</th>
                  <th style={{ padding: "11px 18px" }}>Last sign-in</th>
                  <th style={{ padding: "11px 18px" }} />
                </tr>
              </thead>
              <tbody>
                {visibleUsers.map((u) => {
                  const isMe = u.id === myId;
                  const displayName = u.displayName || u.email.split("@")[0] || u.email;
                  return (
                    <tr key={u.id} style={{ borderBottom: "1px solid var(--color-divider)", background: selected.includes(u.id) ? "var(--color-accent-100)" : "transparent" }}>
                      <td style={{ padding: "14px 18px" }}>
                        <input type="checkbox" checked={selected.includes(u.id)} onChange={() => toggleOne(u.id)} style={{ width: 15, height: 15, accentColor: "var(--color-accent)", cursor: "pointer" }} />
                      </td>
                      <td style={{ padding: "14px 18px" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
                          <span className="admin-avatar">{initials(displayName)}</span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
                              <span style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{displayName}</span>
                              {isMe && <span className="tag tag-neutral" style={{ fontSize: 10 }}>you</span>}
                            </span>
                            <span style={{ display: "block", fontSize: 11.5, color: "var(--color-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</span>
                          </span>
                        </span>
                      </td>
                      <td style={{ padding: "14px 18px" }}>
                        <select
                          className="admin-role-select"
                          value={u.role}
                          disabled={isMe}
                          onChange={(e) => updateUser(u.id, { role: e.target.value as Role }).catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update this account."))}
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td style={{ padding: "14px 18px" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, textTransform: "capitalize" }}>
                          <span className="admin-status-dot" style={{ color: STATUS_COLOR[u.status] }} />{u.status}
                        </span>
                      </td>
                      <td style={{ padding: "14px 18px", fontSize: 12.5, color: "var(--color-text-muted)" }}>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</td>
                      <td style={{ padding: "14px 18px", textAlign: "right" }}>
                        {!isMe && (
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, justifyContent: "flex-end" }}>
                            {u.googleSub && (
                              <button type="button" className="btn btn-ghost" style={{ padding: "7px 12px", fontSize: 12.5 }} title="Unlink the Google account this row answers to, so the next sign-in with this address claims it" onClick={() => resetGoogleLink(u)}>Reset link</button>
                            )}
                            {u.status === "revoked" ? (
                              <button type="button" className="btn btn-secondary" style={{ padding: "7px 14px", fontSize: 12.5 }} onClick={() => updateUser(u.id, { status: "active" }).catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update this account."))}>Restore</button>
                            ) : (
                              <button type="button" className="btn btn-ghost" style={{ padding: "7px 12px", fontSize: 12.5, color: DANGER }} onClick={() => revoke(u)}>Revoke</button>
                            )}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleUsers.length === 0 && <tr><td colSpan={6} className="admin-empty">No users match “{search || (statusFilter === "all" ? "" : statusFilter)}”.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p style={{ margin: "2px 2px 0", fontSize: 11.5, color: "var(--color-text-muted)" }}>
        Invited accounts activate on their first Google sign-in. Revoking keeps all historical data and can be undone.
      </p>

      {inviteOpen && (
        <AdminModal icon="users" title="Invite an account" subtitle="Access starts on their first Google sign-in." onClose={() => setInviteOpen(false)}>
          <form onSubmit={invite} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="admin-modal-fields">
              <div className="field" style={{ flex: "1 1 100%" }}>
                <label>Google email</label>
                <input className="input" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </div>
              <div className="field" style={{ flex: "1 1 140px" }}>
                <label>Role</label>
                <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div className="field" style={{ flex: "1 1 220px" }}>
                <label>Temporary password</label>
                <input className="input" type="text" placeholder="optional — dev / local only" value={password} onChange={(e) => setPassword(e.target.value)} />
                <p className="admin-modal-hint">Only used while this deployment signs in with email + password.</p>
              </div>
            </div>
            {inviteError && <p style={{ margin: 0, fontSize: 12, color: DANGER }}>{inviteError}</p>}
            <div className="admin-modal-foot">
              <p>Created with status “invited”.</p>
              <button type="button" className="btn btn-secondary" onClick={() => setInviteOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={inviteBusy || !email.trim()}>{inviteBusy ? "Inviting…" : "Send invite"}</button>
            </div>
          </form>
        </AdminModal>
      )}
    </div>
  );
}

// FR-2.1/FR-2.3/FR-2.4 (docs/requirements/question-bank-management.md) surfaced under the /admin console per
// FR-13.3: exam create/archive, and per-exam question view/edit/delete.
function ExamsPanel({ onCount }: { onCount: (n: number) => void }) {
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
              <button key={p.id} type="button" className={on ? "admin-provider-toggle is-on" : "admin-provider-toggle"} onClick={() => onToggleProvider(p, exam, !on)}>
                <span className="tick">✓</span>{p.name}{p.archivedAt ? " (archived)" : ""}
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

// Mirrors the worker's EXAM_SLUG_PATTERN (apps/worker/src/lib/examManagement.ts),
// which PATCH /api/exams/:id enforces whatever this form lets through.
const EXAM_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type ExamMetadataPatch = Partial<Pick<Exam, "name" | "slug" | "subject" | "language" | "description" | "passMarkPct">>;

// Name, slug, subject, language, description and pass mark after creation
// (issue #95), through the same PATCH /api/exams/:id the format card uses. Only
// changed fields are sent, so this never overwrites the official format, and a
// blank optional field is sent as null, which clears it.
function ExamMetadataModal({ exam, onSaved, onClose }: { exam: ExamRow; onSaved: (exam: ExamRow) => void; onClose: () => void }) {
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
function OfficialFormatCard({ exam, onSaved }: { exam: ExamRow; onSaved: (format: OfficialMockFormat | null) => void }) {
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
