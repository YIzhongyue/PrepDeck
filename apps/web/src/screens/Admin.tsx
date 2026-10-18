import { useEffect, useState } from "react";
import { AdminIcon } from "../components/AdminModal";
import MascotSettingsPanel from "../components/MascotSettingsPanel";
import McpTokensCard from "../components/McpTokensCard";
import McpConnectionsCard from "../components/McpConnectionsCard";
import { useWorkspaceActions, useWorkspaceState } from "../store/PrepDeckContext";
import type { Breakpoints } from "../lib/responsive";
import { ExamsPanel } from "./admin/ExamsPanel";
import { useAdminOverview, StatusPill, OverviewPanel } from "./admin/OverviewPanel";
import { UsersPanel } from "./admin/UsersPanel";
import type { Tab } from "./admin/shared";

// docs/requirements/question-bank-management.md — the `/admin` console. Navigation here is this app's
// internal `screen` state machine (there is no URL router elsewhere in the
// app either), so this component *is* the route: FR-13.1 keeps its nav
// entry hidden from non-admins (Sidebar/TabBar), and the guard below is the
// state-machine equivalent of FR-13.2's redirect for anyone who still lands
// here. Every mutating call below is independently re-checked server-side
// (requireAdmin) regardless of this guard, per FR-1.6/FR-1.7.
export default function Admin({ bp: _bp }: { bp: Breakpoints }) {
  const state = useWorkspaceState();
  const { go } = useWorkspaceActions();

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

// implementation — Admin MCP tokens are personal access tokens bound to the
// signed-in admin's own account (see routes/mcpTokens.ts), so this reuses
// the exact same card as Settings' User MCP tokens, pointed at the
// admin-only /api/admin/mcp-tokens namespace.
function McpTokensPanel() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <McpTokensCard
        title="Admin MCP tokens"
        description="Privileged tokens for admin-side AI clients (e.g. local-codex, chatgpt-admin) that need question-bank management access. These are separate from, and cannot be used as, User MCP tokens."
        apiBase="/api/admin/mcp-tokens"
        namePlaceholder="e.g. local-codex"
      />
      {/* Issue #102 — Admin MCP connections approved through Google sign-in. */}
      <McpConnectionsCard
        title="Connected admin apps"
        description="Clients you connected to Admin MCP by signing in and approving administrative access. They lose access at once if you disconnect them or stop being an administrator."
        apiBase="/api/admin/mcp-connections"
      />
    </div>
  );
}
