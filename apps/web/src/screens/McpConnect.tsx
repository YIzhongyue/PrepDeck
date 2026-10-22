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
import type { McpAuthorizationDecisionResponse, McpAuthorizationRequestView, McpOAuthScope } from "@prepdeck/shared";
import BrandLogo from "../components/BrandLogo";
import { CompactLanguageSelect } from "../components/LanguageSelect";
import { apiFetch, ApiError } from "../lib/api";
import { t as translate, useI18n } from "../i18n";

// /api/oauth/authorize's reasons for not handing a request over at all; the
// `mcp.connect.errors` messages explain each.
const REQUEST_ERRORS = ["invalid_client", "invalid_redirect_uri", "invalid_request", "unavailable"] as const;
type RequestError = (typeof REQUEST_ERRORS)[number];

// The consent screen's wording for each scope (MCP_OAUTH_SCOPE_INFO has the
// English the MCP server itself reports).
const SCOPE_KEYS: Record<McpOAuthScope, "userRead" | "userWrite" | "adminRead" | "adminWrite"> = {
  "mcp:user:read": "userRead",
  "mcp:user:write": "userWrite",
  "mcp:admin:read": "adminRead",
  "mcp:admin:write": "adminWrite",
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
        <div className="login-card mcp-connect-card">{children}<CompactLanguageSelect /></div>
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
  const { t } = useI18n();
  const known: RequestError = (REQUEST_ERRORS as readonly string[]).includes(reason) ? reason as RequestError : "invalid_request";
  return (
    <Frame>
      <Message title={t(`mcp.connect.errors.${known}.title`)}>{t(`mcp.connect.errors.${known}.body`)}</Message>
    </Frame>
  );
}

export default function McpConnect({ requestId }: { requestId: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const { t, rich } = useI18n();

  useEffect(() => {
    let active = true;
    apiFetch<McpAuthorizationRequestView>(`/api/oauth/requests/${encodeURIComponent(requestId)}`)
      .then((view) => { if (active) setPhase({ kind: "ready", view }); })
      .catch((err) => {
        if (!active) return;
        setPhase({ kind: "gone", message: err instanceof ApiError && err.status === 404 ? err.message
          : translate("mcp.connect.loadFailed") });
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
        else setPhase({ kind: "failed", view, message: translate("mcp.connect.decideFailed") });
      });
  };

  if (phase.kind === "loading") return <Frame><p className="mcp-connect-muted">{t("common.loading")}</p></Frame>;
  if (phase.kind === "gone") return <Frame><Message title={t("mcp.connect.ended")}>{phase.message}</Message></Frame>;
  if (phase.kind === "leaving") {
    return (
      <Frame>
        <Message title={t(phase.approve ? "mcp.connect.connected" : "mcp.connect.notConnected")}>
          {t("mcp.connect.returning")}
        </Message>
      </Frame>
    );
  }

  const { view } = phase;
  const busy = phase.kind === "deciding";
  const admin = view.audience === "admin";
  const clientName = view.client.name ?? t("mcp.connect.unnamedApp");
  const server = admin ? "PrepDeck Admin MCP" : "PrepDeck";
  return (
    <Frame>
      <div className="mcp-connect">
        <div className="mcp-connect-message">
          <h1>{view.eligible ? t("mcp.connect.title", { app: clientName }) : t("mcp.connect.adminRequired")}</h1>
          <p>
            {view.eligible
              ? t("mcp.connect.actsAsYou", { server })
              : t("mcp.connect.adminOnly", { app: clientName })}
          </p>
        </div>

        <dl className="mcp-connect-facts">
          <div>
            <dt>{t("mcp.connect.app")}</dt>
            <dd>
              <span className="mcp-connect-strong">{clientName}</span>
              <span className="tag tag-neutral" title={t("mcp.connect.unverifiedTitle")}>{t("mcp.connect.unverified")}</span>
              <span className="mcp-connect-id">{view.client.kind === "metadata_document" ? view.client.id : t("mcp.connect.clientId", { id: view.client.id })}</span>
            </dd>
          </div>
          <div>
            <dt>{t("mcp.connect.returnsTo")}</dt>
            <dd><span className="mcp-connect-id">{view.client.redirectTarget}</span></dd>
          </div>
          <div>
            <dt>{t("mcp.connect.server")}</dt>
            <dd>
              <span className="mcp-connect-strong">{admin ? "Admin MCP" : "User MCP"}</span>
              {admin && <span className="tag tag-accent-2">{t("mcp.connect.administrativeAccess")}</span>}
              <span className="mcp-connect-id">{view.resource}</span>
            </dd>
          </div>
          <div>
            <dt>{t("mcp.connect.account")}</dt>
            <dd><span className="mcp-connect-strong">{view.account.email}</span></dd>
          </div>
        </dl>

        {view.eligible && (
          <div className="mcp-connect-scopes">
            <h2>{t("mcp.connect.ableTo")}</h2>
            <ul>
              {view.scopes.map((scope) => (
                <li key={scope}>
                  <span className="mcp-connect-strong">{t(`mcp.scopes.${SCOPE_KEYS[scope]}.label`)}</span>
                  <span>{t(`mcp.scopes.${SCOPE_KEYS[scope]}.description`)}</span>
                </li>
              ))}
            </ul>
            <p className="mcp-connect-muted">
              {rich("mcp.connect.trust", { place: t(admin ? "mcp.connect.placeAdmin" : "mcp.connect.placeSettings") })}
            </p>
          </div>
        )}

        {phase.kind === "failed" && <p role="alert" className="mcp-connect-error">{phase.message}</p>}

        <div className="mcp-connect-actions">
          {view.eligible && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => decide(view, true)}>
              {t(busy && phase.approve ? "mcp.connect.connecting" : "mcp.connect.allow")}
            </button>
          )}
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => decide(view, false)}>
            {t(busy && !phase.approve ? "mcp.connect.returningShort" : view.eligible ? "common.cancel" : "mcp.connect.returnToApp")}
          </button>
        </div>
      </div>
    </Frame>
  );
}
