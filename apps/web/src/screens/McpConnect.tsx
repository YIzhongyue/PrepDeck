// Issue #102 — the MCP OAuth consent screen at /connect. An OAuth-capable MCP
// client sends the browser to /api/oauth/authorize, which validates the
// request and hands over here with `?request=<id>` (or `?error=<reason>` when
// the request cannot even be answered to the client). App.tsx puts the
// ordinary login gate in front of the request view, so signing in is the
// website's own Google sign-in (Turnstile included) and comes back here.
//
// The screen shows who is asking (self-asserted client details, marked as
// such), which MCP server and which permissions, and the signed-in account,
// then sends the browser to the client's redirect URI with the decision. It
// never authorizes anything without the Allow click.

import { useEffect, useState, type ReactNode } from "react";
import { MCP_OAUTH_SCOPE_INFO, type McpAuthorizationDecisionResponse, type McpAuthorizationRequestView } from "@prepdeck/shared";
import BrandLogo from "../components/BrandLogo";
import { apiFetch, ApiError } from "../lib/api";

// /api/oauth/authorize's reasons for not handing a request over at all.
const REQUEST_ERRORS: Record<string, { title: string; body: string }> = {
  invalid_client: {
    title: "Unknown app",
    body: "PrepDeck doesn't recognize the app that sent you here, so nothing was connected. Go back to the app and connect again; if it keeps happening, the app may not support PrepDeck's sign-in.",
  },
  invalid_redirect_uri: {
    title: "Can't return to the app",
    body: "The app asked to return to an address it didn't register, so PrepDeck stopped before showing anything. Nothing was connected. Reconnect from the app.",
  },
  invalid_request: {
    title: "Invalid connection request",
    body: "The app's request was malformed, so nothing was connected. Reconnect from the app.",
  },
  unavailable: {
    title: "Connecting apps isn't available",
    body: "This PrepDeck server doesn't accept sign-in from MCP apps. Use a personal access token from Settings → MCP access instead, if the app supports one.",
  },
};

type Phase =
  | { kind: "loading" }
  | { kind: "ready"; view: McpAuthorizationRequestView }
  | { kind: "gone"; message: string }
  | { kind: "deciding"; view: McpAuthorizationRequestView; approve: boolean }
  | { kind: "leaving"; approve: boolean }
  | { kind: "failed"; view: McpAuthorizationRequestView; message: string };

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="login-page">
      <div className="login-grid" aria-hidden="true" />
      <BrandLogo className="login-brand" />
      <div className="login-content">
        <div className="login-card mcp-connect-card">{children}</div>
      </div>
    </div>
  );
}

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mcp-connect-message">
      <h1>{title}</h1>
      <p>{children}</p>
    </div>
  );
}

/** A request PrepDeck refused before it could be shown; no sign-in needed to explain it. */
export function McpConnectError({ reason }: { reason: string }) {
  const known = REQUEST_ERRORS[reason] ?? REQUEST_ERRORS.invalid_request!;
  return (
    <Frame>
      <Message title={known.title}>{known.body}</Message>
    </Frame>
  );
}

export default function McpConnect({ requestId }: { requestId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });

  useEffect(() => {
    let active = true;
    apiFetch<McpAuthorizationRequestView>(`/api/oauth/requests/${encodeURIComponent(requestId)}`)
      .then((view) => { if (active) setPhase({ kind: "ready", view }); })
      .catch((err) => {
        if (!active) return;
        setPhase({ kind: "gone", message: err instanceof ApiError && err.status === 404 ? err.message
          : "PrepDeck couldn't load this connection request. Reload the page, or reconnect from the app." });
      });
    return () => { active = false; };
  }, [requestId]);

  const decide = (view: McpAuthorizationRequestView, approve: boolean) => {
    setPhase({ kind: "deciding", view, approve });
    apiFetch<McpAuthorizationDecisionResponse>(`/api/oauth/requests/${encodeURIComponent(view.id)}/${approve ? "approve" : "deny"}`, { method: "POST", body: "{}" })
      .then(({ redirectTo }) => {
        setPhase({ kind: "leaving", approve });
        window.location.assign(redirectTo);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.status === 404) setPhase({ kind: "gone", message: err.message });
        else setPhase({ kind: "failed", view, message: "That didn't go through. Check your connection and try again." });
      });
  };

  if (phase.kind === "loading") return <Frame><p className="mcp-connect-muted">Loading…</p></Frame>;
  if (phase.kind === "gone") return <Frame><Message title="This request has ended">{phase.message}</Message></Frame>;
  if (phase.kind === "leaving") {
    return (
      <Frame>
        <Message title={phase.approve ? "Connected" : "Not connected"}>
          Returning you to the app. If nothing happens, you can close this tab and continue there.
        </Message>
      </Frame>
    );
  }

  const { view } = phase;
  const busy = phase.kind === "deciding";
  const admin = view.audience === "admin";
  const clientName = view.client.name ?? "An unnamed app";
  return (
    <Frame>
      <div className="mcp-connect">
        <div className="mcp-connect-message">
          <h1>{view.eligible ? `Connect ${clientName} to PrepDeck?` : "Administrator access required"}</h1>
          <p>
            {view.eligible
              ? `It will act as you on ${admin ? "PrepDeck Admin MCP" : "PrepDeck"} with the access below, until you disconnect it.`
              : `${clientName} asked for PrepDeck Admin MCP, which only an active administrator can approve. Return to the app without connecting.`}
          </p>
        </div>

        <dl className="mcp-connect-facts">
          <div>
            <dt>App</dt>
            <dd>
              <span className="mcp-connect-strong">{clientName}</span>
              <span className="tag tag-neutral" title="The app describes itself; PrepDeck has not verified who publishes it.">unverified</span>
              <span className="mcp-connect-id">{view.client.kind === "metadata_document" ? view.client.id : `Client ID ${view.client.id}`}</span>
            </dd>
          </div>
          <div>
            <dt>Returns to</dt>
            <dd><span className="mcp-connect-id">{view.client.redirectTarget}</span></dd>
          </div>
          <div>
            <dt>Server</dt>
            <dd>
              <span className="mcp-connect-strong">{admin ? "Admin MCP" : "User MCP"}</span>
              {admin && <span className="tag tag-accent-2">administrative access</span>}
              <span className="mcp-connect-id">{view.resource}</span>
            </dd>
          </div>
          <div>
            <dt>Account</dt>
            <dd><span className="mcp-connect-strong">{view.account.email}</span></dd>
          </div>
        </dl>

        {view.eligible && (
          <div className="mcp-connect-scopes">
            <h2>It will be able to</h2>
            <ul>
              {view.scopes.map((scope) => (
                <li key={scope}>
                  <span className="mcp-connect-strong">{MCP_OAUTH_SCOPE_INFO[scope].label}</span>
                  <span>{MCP_OAUTH_SCOPE_INFO[scope].description}</span>
                </li>
              ))}
            </ul>
            <p className="mcp-connect-muted">
              Only connect apps you trust. You can disconnect it at any time from {admin ? "Admin → MCP tokens" : "Settings → MCP access"}; signing out of PrepDeck does not disconnect it.
            </p>
          </div>
        )}

        {phase.kind === "failed" && <p role="alert" className="mcp-connect-error">{phase.message}</p>}

        <div className="mcp-connect-actions">
          {view.eligible && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide(view, true)}>
              {busy && phase.approve ? "Connecting…" : "Allow access"}
            </button>
          )}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => decide(view, false)}>
            {busy && !phase.approve ? "Returning…" : view.eligible ? "Cancel" : "Return to the app"}
          </button>
        </div>
      </div>
    </Frame>
  );
}
