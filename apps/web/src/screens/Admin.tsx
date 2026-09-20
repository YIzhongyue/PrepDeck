import { useEffect, useState } from "react";
import type {
  AdminOverviewResponse,
  AdminUsersListResponse,
  Exam,
  InviteUserResponse,
  Provider,
  Role,
  UpdateUserResponse,
  User,
  UserStatus
} from "@prepdeck/shared";
import QuestionsPanel from "../components/QuestionsPanel";
import McpTokensCard from "../components/McpTokensCard";
import { apiFetch, ApiError } from "../lib/api";
import { usePrepDeck } from "../store/PrepDeckContext";
import type { Breakpoints } from "../lib/responsive";

type Tab = "overview" | "users" | "exams" | "mcp";
interface ExamRow extends Exam {
  questionCount: number;
}

const DANGER = "var(--color-danger, #c0392b)";

function AdminIcon({ name }: { name: "overview" | "users" | "exams" | "shield" | "arrow" | "back" | "plus" | "search" | "key" }) {
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    exams: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M8 7h8M8 11h6"/></>,
    shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6"/></>,
    back: <><path d="M19 12H5M11 18l-6-6 6-6"/></>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    key: <><circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/></>
  };
  return <svg className="admin-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function initials(source: string): string {
  const cleaned = source.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((p) => p[0]).join("");
  return (cleaned || source.slice(0, 2)).toUpperCase();
}

function AdminModal({
  icon, title, subtitle, onClose, children
}: {
  icon: "users" | "exams" | "shield";
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="dialog-backdrop" style={{ zIndex: 70 }} onClick={onClose}>
      <div className="admin-modal" onClick={(e) => e.stopPropagation()}>
        <div className="admin-modal-head">
          <span className="admin-modal-icon"><AdminIcon name={icon} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <button type="button" className="admin-modal-close" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
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

  useEffect(() => {
    if (state.me && !isAdmin) go("dash");
  }, [state.me, isAdmin, go]);

  if (!isAdmin || !state.me) return null;

  const tabs: { id: Tab; label: string; count: number | null }[] = [
    { id: "overview", label: "Overview", count: null },
    { id: "users", label: "People", count: userCount },
    { id: "exams", label: "Content", count: examCount },
    { id: "mcp", label: "MCP tokens", count: null }
  ];

  return (
    <div className="admin-shell" style={{ animation: "pd-rise .28s ease both" }}>
      <header className="admin-header">
        <div className="admin-header-copy">
          <div className="admin-header-eyebrow"><span className="admin-header-eyebrow-icon"><AdminIcon name="shield" /></span> Admin workspace</div>
          <h1>Access &amp; content</h1>
          <p>Invite the people who study here, and keep the exam library tidy.</p>
        </div>
        <div className="admin-status-pill"><span className="admin-live-dot" /> System operational</div>
      </header>

      <nav className="admin-tabs" aria-label="Admin sections">
        {tabs.map((t) => {
          const on = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
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
      {tab === "overview" && <OverviewPanel onNavigate={setTab} />}
      {tab === "users" && <UsersPanel myId={state.me.id} onCount={setUserCount} />}
      {tab === "exams" && <ExamsPanel onCount={setExamCount} />}
      {tab === "mcp" && <McpTokensPanel />}
      </section>
    </div>
  );
}

// FR-13.4: at-a-glance usage counts, sourced from GET /api/admin/overview.
function OverviewPanel({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AdminOverviewResponse>("/api/admin/overview")
      .then(setData)
      .catch(() => setError("Could not load the overview."));
  }, []);

  if (error) return <p style={{ fontSize: 13, color: DANGER }}>{error}</p>;
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
        {stat("Active learners", data.users.active, "blue", `${data.users.total} authorized total`)}
        {stat("Question library", data.questions.total, "violet", `Across ${data.exams.total} exams`)}
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
const STATUS_TAG_CLASS: Record<UserStatus, string> = { active: "tag-accent-2", invited: "tag-accent", revoked: "tag-neutral" };

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

  const updateUser = (id: string, patch: { role?: Role; status?: "active" | "revoked" }) => {
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
                            <span style={{ display: "block", fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</span>
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
                      <td style={{ padding: "14px 18px", fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 60%, transparent)" }}>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}</td>
                      <td style={{ padding: "14px 18px", textAlign: "right" }}>
                        {!isMe && (
                          u.status === "revoked" ? (
                            <button type="button" className="btn btn-secondary" style={{ padding: "7px 14px", fontSize: 12.5 }} onClick={() => updateUser(u.id, { status: "active" }).catch((err) => window.alert(err instanceof ApiError ? err.message : "Could not update this account."))}>Restore</button>
                          ) : (
                            <button type="button" className="btn btn-ghost" style={{ padding: "7px 12px", fontSize: 12.5, color: DANGER }} onClick={() => revoke(u)}>Revoke</button>
                          )
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
      <p style={{ margin: "2px 2px 0", fontSize: 11.5, color: "color-mix(in srgb, var(--color-text) 50%, transparent)" }}>
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
  const [modal, setModal] = useState<"exam" | "provider" | null>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [subject, setSubject] = useState("");
  const [language, setLanguage] = useState("");
  const [badgeIcon, setBadgeIcon] = useState<File | null>(null);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [providerName, setProviderName] = useState("");
  const [providerShortName, setProviderShortName] = useState("");
  const [providerWebsite, setProviderWebsite] = useState("");
  const [providerIcon, setProviderIcon] = useState<File | null>(null);
  const [providerBusy, setProviderBusy] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);

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
    apiFetch<{ providers: Provider[] }>("/api/providers").then(({ providers }) => setProviders(providers));
  }, []);

  useEffect(() => { onCount(exams.length); }, [exams.length, onCount]);

  const createProvider = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setProviderBusy(true);
    setProviderError(null);
    try {
      const { provider } = await apiFetch<{ provider: Provider }>("/api/providers", { method: "POST", body: JSON.stringify({ name: providerName, shortName: providerShortName, websiteUrl: providerWebsite || undefined }) });
      let created = provider;
      if (providerIcon) {
        const { iconUrl } = await apiFetch<{ iconUrl: string }>(`/api/providers/${provider.id}/icon`, { method: "POST", headers: { "Content-Type": providerIcon.type }, body: providerIcon });
        created = { ...created, iconUrl };
      }
      setProviders((current) => [...current, created].sort((a, b) => a.name.localeCompare(b.name)));
      setProviderName(""); setProviderShortName(""); setProviderWebsite(""); setProviderIcon(null);
      e.currentTarget.reset();
      setModal(null);
    } catch (err) {
      setProviderError(err instanceof ApiError ? err.message : "Could not create provider.");
    } finally {
      setProviderBusy(false);
    }
  };

  const setProviderExam = async (provider: Provider, exam: ExamRow, assigned: boolean) => {
    await apiFetch(`/api/providers/${provider.id}/exams/${exam.id}`, { method: assigned ? "PUT" : "DELETE" });
    setExams((current) => current.map((item) => item.id !== exam.id ? item : { ...item, providers: assigned ? [...item.providers, provider] : item.providers.filter((p) => p.id !== provider.id) }));
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
      <ExamDetail
        exam={selected}
        providers={providers}
        onBack={() => setSelectedExamId(null)}
        onToggleProvider={setProviderExam}
        onNewProvider={() => setModal("provider")}
        onToggleArchive={toggleArchive}
        onReplaceBadge={replaceBadge}
      />
    );
  }

  const groupKey = (ex: ExamRow) => ex.providers[0]?.id ?? "__other__";
  const groupLabel = (ex: ExamRow) => ex.providers[0]?.name ?? "Other";
  const hasOther = exams.some((ex) => ex.providers.length === 0);
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
          {providers.map((p) => (
            <button key={p.id} type="button" className={providerFilter === p.id ? "admin-provider-pill is-active" : "admin-provider-pill"} onClick={() => setProviderFilter(p.id)}>{p.shortName || p.name}</button>
          ))}
          {hasOther && <button type="button" className={providerFilter === "__other__" ? "admin-provider-pill is-active" : "admin-provider-pill"} onClick={() => setProviderFilter("__other__")}>Other</button>}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button type="button" className="btn btn-secondary" onClick={() => setModal("provider")}>New provider</button>
          <button type="button" className="btn btn-primary" onClick={() => setModal("exam")}><AdminIcon name="plus" /> New exam</button>
        </div>
      </div>

      {loadError && <p style={{ fontSize: 13, color: DANGER }}>{loadError}</p>}
      {loading && !loadError && <p style={{ fontSize: 13, opacity: 0.7 }}>Loading…</p>}

      {!loading && !loadError && (
        <>
          {groups.map((g) => (
            <div key={g.key} className="admin-provider-group">
              <div className="admin-provider-group-head">
                <span>{g.label}</span>
                <span className="admin-provider-group-rule" />
                <span>{g.exams.length} {g.exams.length === 1 ? "exam" : "exams"}</span>
              </div>
              <div className="admin-exam-grid">
                {g.exams.map((ex) => (
                  <button key={ex.id} type="button" className={ex.archivedAt ? "admin-exam-card is-archived" : "admin-exam-card"} onClick={() => setSelectedExamId(ex.id)}>
                    <span style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                      <span className="admin-exam-badge">
                        {ex.badgeIconUrl ? <img src={ex.badgeIconUrl} alt="" /> : (ex.providers[0]?.shortName ?? ex.slug.slice(0, 3).toUpperCase())}
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

      {modal === "provider" && (
        <AdminModal icon="shield" title="New provider" subtitle="Providers group exams in menus and selectors." onClose={() => setModal(null)}>
          <form onSubmit={createProvider} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="admin-modal-fields">
              <div className="field" style={{ flex: "1 1 100%" }}><label>Name</label><input className="input" placeholder="Amazon Web Services" value={providerName} onChange={(e) => setProviderName(e.target.value)} required /></div>
              <div className="field" style={{ flex: "1 1 140px" }}><label>Short name</label><input className="input" placeholder="AWS" value={providerShortName} onChange={(e) => setProviderShortName(e.target.value)} required /></div>
              <div className="field" style={{ flex: "1 1 220px" }}><label>Official URL</label><input className="input" type="url" placeholder="https://…" value={providerWebsite} onChange={(e) => setProviderWebsite(e.target.value)} /></div>
              <div className="field" style={{ flex: "1 1 100%" }}>
                <label>Icon</label>
                <div className="admin-modal-file">
                  <span>square PNG / SVG</span>
                  <label>{providerIcon ? providerIcon.name : "Browse"}<input type="file" hidden accept="image/jpeg,image/png,image/webp,image/svg+xml" onChange={(e) => setProviderIcon(e.target.files?.[0] ?? null)} /></label>
                </div>
              </div>
            </div>
            {providerError && <p style={{ margin: 0, fontSize: 12, color: DANGER }}>{providerError}</p>}
            <div className="admin-modal-foot">
              <p>Assign exams from any exam’s detail page.</p>
              <button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={providerBusy || !providerName.trim() || !providerShortName.trim()}>{providerBusy ? "Adding…" : "Add provider"}</button>
            </div>
          </form>
        </AdminModal>
      )}

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
  exam, providers, onBack, onToggleProvider, onNewProvider, onToggleArchive, onReplaceBadge
}: {
  exam: ExamRow;
  providers: Provider[];
  onBack: () => void;
  onToggleProvider: (provider: Provider, exam: ExamRow, assigned: boolean) => void;
  onNewProvider: () => void;
  onToggleArchive: (exam: ExamRow) => void;
  onReplaceBadge: (exam: ExamRow, file: File) => void;
}) {
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
            <span>{exam.questionCount} questions</span>
            <span>Subject · {exam.subject || "—"}</span>
            <span>Language · {exam.language || "—"}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
            <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "color-mix(in srgb, var(--color-text) 55%, transparent)" }}>Tap to assign or unassign this exam.</p>
          </div>
          <button type="button" className="btn btn-ghost" style={{ flex: "none" }} onClick={onNewProvider}>New provider</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {providers.map((p) => {
            const on = exam.providers.some((x) => x.id === p.id);
            return (
              <button key={p.id} type="button" className={on ? "admin-provider-toggle is-on" : "admin-provider-toggle"} onClick={() => onToggleProvider(p, exam, !on)}>
                <span className="tick">✓</span>{p.name}
              </button>
            );
          })}
          {providers.length === 0 && <p style={{ margin: 0, fontSize: 12.5, opacity: 0.6 }}>No providers yet.</p>}
        </div>
      </div>

      <QuestionsPanel exam={exam} />
    </div>
  );
}
