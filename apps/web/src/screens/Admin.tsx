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
import { useI18n } from "../i18n";

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
  const { t } = useI18n();

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
    { id: "overview", label: t("admin.tabs.overview"), count: null },
    { id: "users", label: t("admin.tabs.users"), count: userCount },
    { id: "exams", label: t("admin.tabs.exams"), count: examCount },
    { id: "mcp", label: t("admin.tabs.mcp"), count: null },
    { id: "appearance", label: t("admin.tabs.appearance"), count: null }
  ];

  // `backwards`, not `both` — see the note on `@keyframes pd-rise` in app.css.
  return (
    <div className="admin-shell" style={{ animation: "pd-rise .28s ease backwards" }}>
      <header className="admin-header">
        <div className="admin-header-copy">
          <div className="admin-header-eyebrow"><span className="admin-header-eyebrow-icon"><AdminIcon name="shield" /></span> {t("admin.header.eyebrow")}</div>
          <h1>{t("admin.header.title")}</h1>
          <p>{t("admin.header.intro")}</p>
        </div>
        <StatusPill health={overview.health} />
      </header>

      <nav className="admin-tabs" aria-label={t("admin.tabs.label")}>
        {tabs.map((item) => {
          const on = tab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              // A selected tab that sits past the edge of the scrolled row comes into view.
              onClick={(e) => { setTab(item.id); e.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" }); }}
              className={on ? "admin-tab is-active" : "admin-tab"}
              aria-current={on ? "page" : undefined}
            >
              {item.label}
              {item.count !== null && <span className="admin-tab-badge">{item.count}</span>}
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
  const { t } = useI18n();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <McpTokensCard
        title={t("admin.mcp.title")}
        description={t("admin.mcp.desc")}
        apiBase="/api/admin/mcp-tokens"
        namePlaceholder={t("admin.mcp.namePlaceholder")}
      />
      {/* Issue #102 — Admin MCP connections approved through Google sign-in. */}
      <McpConnectionsCard
        title={t("admin.mcp.connectionsTitle")}
        description={t("admin.mcp.connectionsDesc")}
        apiBase="/api/admin/mcp-connections"
      />
    </div>
  );
}
