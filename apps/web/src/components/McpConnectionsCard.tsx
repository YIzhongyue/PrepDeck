// Issue #102 — connected OAuth applications (grants), shown next to the PAT
// card in Settings (User MCP) and the Admin console (Admin MCP). A grant is
// what an OAuth-capable MCP client received when the user signed in with
// Google and approved it; it is separate from personal access tokens and
// holds no secret this card could show. Revoking ends the client's access on
// its next request; signing out of PrepDeck does not.

import { useEffect, useState } from "react";
import { MCP_OAUTH_SCOPE_INFO, type ListMcpOAuthGrantsResponse, type McpOAuthGrantSummary } from "@prepdeck/shared";
import { apiFetch, ApiError } from "../lib/api";
import { Button } from "@/components/base/buttons/button";
import "./McpTokensCard.css";

const DANGER = "var(--color-danger)";

function formatWhen(ms: number): string {
  const date = new Date(ms);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `today, ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return date.toLocaleDateString([], { month: "short", day: "numeric", ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}

function grantMeta(grant: McpOAuthGrantSummary): string {
  const access = grant.scopes.map((scope) => MCP_OAUTH_SCOPE_INFO[scope].access);
  const parts = [access.includes("write") ? "Read and write" : "Read only", `Connected ${formatWhen(grant.createdAt)}`,
    grant.lastUsedAt === null ? "Never used" : `Last used ${formatWhen(grant.lastUsedAt)}`];
  if (grant.status === "expired") parts.push("Idle too long — reconnect from the app");
  return parts.join(" · ");
}

export default function McpConnectionsCard({ title, description, apiBase }: { title: string; description: string; apiBase: string }) {
  const [state, setState] = useState<{ enabled: boolean; grants: McpOAuthGrantSummary[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoadError(null);
    apiFetch<ListMcpOAuthGrantsResponse>(apiBase)
      // A body without a grant list is a failed load, not a reason to break Settings.
      .then((body) => {
        if (!active) return;
        if (Array.isArray(body?.grants)) setState({ enabled: body.enabled === true, grants: body.grants });
        else setLoadError("Could not load connected apps.");
      })
      .catch(() => { if (active) setLoadError("Could not load connected apps."); });
    return () => { active = false; };
  }, [apiBase]);

  // Nothing to say on a server without OAuth, unless connections made before
  // it was turned off are still listed and can be revoked.
  if (state && !state.enabled && state.grants.length === 0) return null;

  const revoke = (grant: McpOAuthGrantSummary) => {
    const name = grant.clientName ?? "this app";
    if (!window.confirm(`Disconnect ${name}? It stops working immediately and has to be connected again to regain access.`)) return;
    setBusyId(grant.id);
    setRowError(null);
    apiFetch(`${apiBase}/${grant.id}/revoke`, { method: "POST" })
      .then(() => setState((prev) => prev && { ...prev, grants: prev.grants.filter((g) => g.id !== grant.id) }))
      .catch((err) => setRowError(err instanceof ApiError ? err.message : "Could not disconnect this app."))
      .finally(() => setBusyId(null));
  };

  return (
    <div className="mcp-card">
      <div className="mcp-head">
        <div className="mcp-head-text">
          <h3>{title}</h3>
          <p>{description}</p>
          {state && !state.enabled && <p>New connections are turned off on this server; existing ones stop working until they are turned back on.</p>}
        </div>
      </div>

      <div className="mcp-body">
        {loadError && <p style={{ margin: 0, fontSize: 13, color: DANGER }}>{loadError}</p>}
        {!state && !loadError && <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>Loading…</p>}
        {state && state.grants.length === 0 && <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-text-muted)" }}>No connected apps.</p>}
        {rowError && <p style={{ margin: 0, fontSize: 12, color: DANGER }}>{rowError}</p>}
      </div>

      {state?.grants.map((grant) => (
        <div key={grant.id} className="mcp-token" data-status={grant.status === "active" ? "active" : "expired"}>
          <span className="mcp-token-icon" aria-hidden="true">{(grant.clientName ?? "?").trim().charAt(0).toUpperCase() || "?"}</span>
          <div className="mcp-token-text">
            <div className="mcp-token-name-row">
              <span className="mcp-token-name">{grant.clientName ?? "Unnamed app"}</span>
              <span className={`tag ${grant.status === "active" ? "tag-accent-2" : "tag-neutral"}`}>{grant.status === "active" ? "connected" : "expired"}</span>
            </div>
            <div className="mcp-token-meta">{grantMeta(grant)}</div>
            <div className="mcp-token-meta" style={{ overflowWrap: "anywhere" }}>{grant.clientId}</div>
          </div>
          <div className="mcp-token-actions">
            <Button color="link-destructive" size="sm" isDisabled={busyId === grant.id} onClick={() => revoke(grant)}>Disconnect</Button>
          </div>
        </div>
      ))}
    </div>
  );
}
