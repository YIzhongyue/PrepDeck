// implementation — self-service MCP token lifecycle UI. Shared by Settings'
// "MCP access" card (User MCP, own tokens) and the Admin console's "MCP
// tokens" tab (Admin MCP, gated server-side by requireAdmin) — only the
// `apiBase` and copy differ between the two mounts.

import { useEffect, useRef, useState } from "react";
import { MCP_TOKEN_NAME_MAX_LENGTH, TURNSTILE_ACTIONS, type CreateMcpCredentialResponse, type ListMcpCredentialsResponse, type McpCredentialSummary } from "@prepdeck/shared";
import { apiFetch, ApiError } from "../lib/api";
import { copyText } from "../lib/practicePrompt";
import { buildUserMcpSetupPrompt, isFreshMcpSecretUsable, type FreshMcpSecret } from "../lib/mcpSetupPrompt";
import { isHumanVerificationRefusal, turnstileHeaders, useTurnstileConfig } from "../lib/turnstile";
import TurnstileWidget, { TurnstileConfigError } from "./TurnstileWidget";
import { formatDate, formatTime, t as translate, useI18n } from "../i18n";
// implementation — shared Untitled UI primitives; docs/guides/ui-components.md.
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import "./McpTokensCard.css";

const DANGER = "var(--color-danger)";
const EXPIRY_OPTIONS = ["never", "30", "90", "365"] as const;
type CopyKind = "token" | "prompt";
const STATUS_TAG_CLASS: Record<McpCredentialSummary["status"], string> = { active: "tag-accent-2", revoked: "tag-neutral", expired: "tag-neutral" };

// "today, 8:02 AM" for today, "Sep 12" this year, "Sep 12, 2025" before that.
export function formatWhen(ms: number, withTime: boolean): string {
  const date = new Date(ms);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return withTime ? translate("common.todayAt", { time: formatTime(date, { hour: "numeric", minute: "2-digit" }) }) : translate("common.today");
  }
  return formatDate(date, { month: "short", day: "numeric", ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }) });
}

function tokenMeta(token: McpCredentialSummary): string {
  const parts = [
    translate("mcp.tokens.created", { when: formatWhen(token.createdAt, false) }),
    token.lastUsedAt === null ? translate("mcp.tokens.neverUsed") : translate("mcp.tokens.lastUsed", { when: formatWhen(token.lastUsedAt, true) })
  ];
  if (token.expiresAt !== null) parts.push(translate(token.expiresAt <= Date.now() ? "mcp.tokens.expired" : "mcp.tokens.expires", { when: formatWhen(token.expiresAt, false) }));
  else if (token.status === "active") parts.push(translate("mcp.tokens.neverExpires"));
  return parts.join(" · ");
}

export default function McpTokensCard({
  title, description, apiBase, namePlaceholder, enableSetupPrompt = false, onActiveCountChange
}: {
  title: string;
  description: string;
  apiBase: string;
  namePlaceholder?: string;
  enableSetupPrompt?: boolean;
  // Told how many tokens are active once they load and after every change,
  // for a summary shown outside the card (Settings' section index).
  onActiveCountChange?: (count: number) => void;
}) {
  const { t: tr } = useI18n();
  const [tokens, setTokens] = useState<McpCredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [expiresDraft, setExpiresDraft] = useState<(typeof EXPIRY_OPTIONS)[number]>("never");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Creating and rotating both issue a bearer token, so both need a Turnstile
  // token when the deployment uses it (issue #82). Until the configuration is
  // known (loading, or a lookup to retry) neither goes ahead. Each token is
  // spent by one request: a new widget key after every attempt mounts a fresh
  // widget for the next one.
  const { config: turnstileConfig, reload: reloadTurnstile } = useTurnstileConfig();
  const turnstileSiteKey = turnstileConfig.status === "ready" ? turnstileConfig.siteKey : null;
  const verificationOff = turnstileConfig.status === "ready" && !turnstileSiteKey;
  const [createHumanToken, setCreateHumanToken] = useState<string | null>(null);
  const [createWidgetKey, setCreateWidgetKey] = useState(0);
  const awaitingHumanToken = !verificationOff && !createHumanToken;
  // The token whose row asks for the check; its own button then rotates it.
  const [verifyingRotation, setVerifyingRotation] = useState<McpCredentialSummary | null>(null);
  const [rotationHumanToken, setRotationHumanToken] = useState<string | null>(null);
  // The Worker asked for verification the configuration said was off: it
  // has changed since the card loaded, so look again and show the widget.
  const noteRefusal = (err: unknown) => { if (verificationOff && isHumanVerificationRefusal(err)) reloadTurnstile(); };
  const turnstileSlot = (onTokenChange: (token: string | null) => void, key?: number) =>
    turnstileConfig.status === "failed" ? <TurnstileConfigError onRetry={reloadTurnstile} />
      : turnstileSiteKey ? <TurnstileWidget key={key} siteKey={turnstileSiteKey} action={TURNSTILE_ACTIONS.mcpToken} onTokenChange={onTokenChange} /> : null;

  // The freshly issued/rotated token is shown exactly once, then discarded —
  // it is never retrievable again after this card forgets it.
  const [revealed, setRevealed] = useState<FreshMcpSecret | null>(null);
  const revealedRef = useRef<FreshMcpSecret | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [copyFallback, setCopyFallback] = useState<{ text: string; kind: CopyKind } | null>(null);
  const copyGeneration = useRef(0);
  // Explicit opt-in plus an audience guard protects this shared Admin component.
  const userSetupEnabled = enableSetupPrompt && apiBase === "/api/mcp-tokens";

  function reveal(secret: FreshMcpSecret | null) {
    copyGeneration.current += 1;
    revealedRef.current = secret;
    setRevealed(secret);
    setShowToken(false);
    setCopyOk(false);
    setCopyMessage(null);
    setCopyFallback(null);
  }

  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);

  const activeCount = loading || loadError ? null : tokens.filter((t) => t.status === "active").length;
  useEffect(() => {
    if (activeCount !== null) onActiveCountChange?.(activeCount);
  }, [activeCount, onActiveCountChange]);

  useEffect(() => {
    let active = true;
    reveal(null);
    setLoadError(null);
    setLoading(true);
    apiFetch<ListMcpCredentialsResponse>(apiBase)
      .then(({ credentials }) => { if (active) setTokens(credentials); })
      .catch(() => { if (active) setLoadError(translate("mcp.tokens.loadFailed")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; copyGeneration.current += 1; revealedRef.current = null; };
  }, [apiBase]);

  useEffect(() => {
    if (revealed?.expiresAt == null) return;
    let timer: ReturnType<typeof setTimeout>;
    const checkExpiry = () => {
      if (!isFreshMcpSecretUsable(revealed)) { reveal(null); return; }
      timer = setTimeout(checkExpiry, Math.min(revealed.expiresAt! - Date.now(), 2_147_483_647));
    };
    checkExpiry();
    return () => clearTimeout(timer);
  }, [revealed]);

  const create = async () => {
    const name = nameDraft.trim();
    if (!name) { setCreateError(translate("mcp.tokens.nameRequired")); return; }
    if (awaitingHumanToken) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const expiresInDays = expiresDraft === "never" ? undefined : Number(expiresDraft);
      const { credential, token } = await apiFetch<CreateMcpCredentialResponse>(apiBase, {
        method: "POST", body: JSON.stringify({ name, expiresInDays }), headers: turnstileHeaders(createHumanToken)
      });
      setTokens((prev) => [credential, ...prev]);
      reveal({ token, id: credential.id, name: credential.name, expiresAt: credential.expiresAt });
      setNameDraft("");
      setExpiresDraft("never");
      setCreating(false);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : translate("mcp.tokens.createFailed"));
      noteRefusal(err);
    } finally {
      setCreateBusy(false);
      if (turnstileSiteKey) setCreateWidgetKey((key) => key + 1);
    }
  };

  const revoke = (t: McpCredentialSummary) => {
    if (!window.confirm(translate("mcp.tokens.revokeConfirm", { name: t.name }))) return;
    if (revealedRef.current?.id === t.id) reveal(null);
    if (verifyingRotation?.id === t.id) setVerifyingRotation(null);
    setBusyId(t.id);
    setRowError(null);
    apiFetch(`${apiBase}/${t.id}/revoke`, { method: "POST" })
      .then(() => setTokens((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: "revoked" as const, revokedAt: Date.now() } : x))))
      .catch((err) => setRowError(err instanceof ApiError ? err.message : translate("mcp.tokens.revokeFailed")))
      .finally(() => setBusyId(null));
  };

  const rotate = (t: McpCredentialSummary) => {
    setRowError(null);
    if (verificationOff) {
      if (!window.confirm(translate("mcp.tokens.rotateConfirm", { name: t.name }))) return;
      rotateVerified(t, null);
      return;
    }
    // With Turnstile the row takes the confirmation's place: it says what
    // rotating does, asks for the check, and rotates only on its own button.
    setRotationHumanToken(null);
    setVerifyingRotation(t);
  };

  const rotateVerified = (t: McpCredentialSummary, humanToken: string | null) => {
    setVerifyingRotation(null);
    // Rotation can revoke the predecessor even when replacement issuance fails.
    if (revealedRef.current?.id === t.id) reveal(null);
    setBusyId(t.id);
    setRowError(null);
    apiFetch<CreateMcpCredentialResponse>(`${apiBase}/${t.id}/rotate`, { method: "POST", headers: turnstileHeaders(humanToken) })
      .then(({ credential, token }) => {
        setTokens((prev) => [credential, ...prev.map((x) => (x.id === t.id ? { ...x, status: "revoked" as const, revokedAt: Date.now() } : x))]);
        reveal({ token, id: credential.id, name: credential.name, expiresAt: credential.expiresAt });
      })
      .catch((err) => { setRowError(err instanceof ApiError ? err.message : translate("mcp.tokens.rotateFailed")); noteRefusal(err); })
      .finally(() => setBusyId(null));
  };

  const copyValue = async (text: string, kind: CopyKind, secretId?: string) => {
    const generation = ++copyGeneration.current;
    setCopyOk(false);
    setCopyMessage(null);
    setCopyFallback(null);
    const current = () => generation === copyGeneration.current && (!secretId ||
      (revealedRef.current?.id === secretId && isFreshMcpSecretUsable(revealedRef.current)));
    try {
      await copyText(text);
      if (!current()) return;
      setCopyOk(kind === "token");
      setCopyMessage(translate(kind === "token" ? "mcp.tokens.tokenCopied" : "mcp.tokens.promptCopied"));
    } catch {
      if (!current()) return;
      setCopyFallback({ text, kind });
    }
  };

  const copyToken = () => {
    if (!isFreshMcpSecretUsable(revealedRef.current)) { reveal(null); return; }
    void copyValue(revealedRef.current.token, "token", revealedRef.current.id);
  };

  const copySetupPrompt = (includeToken: boolean) => {
    if (!userSetupEnabled) return;
    const secret = revealedRef.current;
    if (includeToken && !isFreshMcpSecretUsable(secret)) { reveal(null); return; }
    void copyValue(buildUserMcpSetupPrompt(window.location.origin, includeToken ? secret!.token : undefined),
      "prompt", includeToken ? secret!.id : undefined);
  };

  return (
    <div className="mcp-card">
      <div className="mcp-head">
        <div className="mcp-head-text">
          <h3>{title}</h3>
          <p>{description}</p>
          {userSetupEnabled && (
            <p>{tr("mcp.tokens.setupIntro")}</p>
          )}
        </div>
        <div className="mcp-head-actions">
          {userSetupEnabled && (
            <Button color="secondary" size="md" className="mcp-setup-button" onClick={() => copySetupPrompt(false)}>{tr("mcp.tokens.copySetupPrompt")}</Button>
          )}
          {!creating && <Button size="md" onClick={() => setCreating(true)}>{tr("mcp.tokens.createButton")}</Button>}
        </div>
      </div>

      {/* Empty, and so hidden, unless one of these has something to show. */}
      <div className="mcp-body">
        {creating && (
          <div className="mcp-panel">
            <Input
              label={tr("mcp.tokens.name")}
              placeholder={namePlaceholder ?? tr("mcp.tokens.namePlaceholder")}
              maxLength={MCP_TOKEN_NAME_MAX_LENGTH}
              value={nameDraft}
              onChange={(value) => { setNameDraft(value); setCreateError(null); }}
              isInvalid={!!createError}
            />
            <div>
              <span style={{ display: "block", fontSize: 12, color: "var(--color-text-muted)", marginBottom: 8 }}>{tr("mcp.tokens.expiration")}</span>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {EXPIRY_OPTIONS.map((id) => {
                  const on = expiresDraft === id;
                  return (
                    <button
                      key={id} type="button" onClick={() => setExpiresDraft(id)}
                      style={{
                        padding: "6px 14px", borderRadius: 999, fontSize: 12.5, cursor: "pointer", font: "inherit",
                        background: on ? "var(--color-accent)" : "transparent", color: on ? "var(--color-bg)" : "var(--color-text)",
                        border: `1.5px solid ${on ? "var(--color-accent)" : "var(--color-divider)"}`
                      }}
                    >
                      {id === "never" ? tr("mcp.tokens.expiry.never") : id === "365" ? tr("mcp.tokens.expiry.year") : tr("mcp.tokens.expiry.days", { count: Number(id) })}
                    </button>
                  );
                })}
              </div>
            </div>
            {turnstileSlot(setCreateHumanToken, createWidgetKey)}
            {createError && <p style={{ margin: 0, fontSize: 12, color: DANGER }}>{createError}</p>}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Button size="md" isDisabled={createBusy || !nameDraft.trim() || awaitingHumanToken} isLoading={createBusy} showTextWhileLoading onClick={create}>
                {createBusy ? tr("mcp.tokens.creating") : tr("mcp.tokens.create")}
              </Button>
              <Button color="secondary" size="md" onClick={() => { setCreating(false); setCreateError(null); }}>{tr("common.cancel")}</Button>
            </div>
          </div>
        )}

        {revealed && (
          <div className="mcp-panel mcp-panel-reveal">
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{tr("mcp.tokens.copyNow", { name: revealed.name })}</p>
            <div className="mcp-secret-actions">
              <Input
                className="mcp-secret-field"
                aria-label={tr("mcp.tokens.newToken")}
                isReadOnly
                type={showToken ? "text" : "password"}
                value={revealed.token}
                inputClassName={showToken ? "font-mono text-xs" : undefined}
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button color="secondary" size="md" onClick={() => setShowToken((v) => !v)}>{showToken ? tr("mcp.tokens.hide") : tr("mcp.tokens.show")}</Button>
              <Button color="secondary" size="md" onClick={copyToken}>{copyOk ? tr("common.copied") : tr("common.copy")}</Button>
            </div>
            {userSetupEnabled && (
              <div className="mcp-setup-actions">
                <Button color="secondary" size="md" className="mcp-setup-button" onClick={() => copySetupPrompt(true)}>{tr("mcp.tokens.copySetupPromptWithToken")}</Button>
                <p>{tr("mcp.tokens.includesSecret")}</p>
              </div>
            )}
            <Button color="link-color" size="sm" className="self-start" onClick={() => reveal(null)}>{tr("common.done")}</Button>
          </div>
        )}

        {copyMessage && <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{copyMessage}</p>}
        {copyFallback && (
          <div className="mcp-setup-actions">
            <p role="alert">{tr(copyFallback.kind === "token" ? "mcp.tokens.copyFailedToken" : "mcp.tokens.copyFailedPrompt")}</p>
            <TextArea className="mcp-setup-fallback" aria-label={tr(copyFallback.kind === "token" ? "mcp.tokens.copyManuallyToken" : "mcp.tokens.copyManuallyPrompt")} isReadOnly
              rows={6} value={copyFallback.text} textAreaClassName="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
          </div>
        )}

        {loadError && <p style={{ margin: 0, fontSize: 13, color: DANGER }}>{loadError}</p>}
        {loading && !loadError && <p style={{ margin: 0, fontSize: 13, color: "var(--color-text-muted)" }}>{tr("common.loading")}</p>}
        {!loading && !loadError && tokens.length === 0 && !creating && (
          <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-text-muted)" }}>{tr("mcp.tokens.empty")}</p>
        )}
        {rowError && <p style={{ margin: 0, fontSize: 12, color: DANGER }}>{rowError}</p>}
      </div>

      {!loading && !loadError && tokens.map((t) => (
        <div key={t.id} className="mcp-token" data-status={t.status}>
          <span className="mcp-token-icon" aria-hidden="true">{t.name.trim().charAt(0).toUpperCase() || "?"}</span>
          <div className="mcp-token-text">
            <div className="mcp-token-name-row">
              <span className="mcp-token-name">{t.name}</span>
              <span className={`tag ${STATUS_TAG_CLASS[t.status]}`}>{tr(`mcp.tokens.status.${t.status}`)}</span>
            </div>
            <div className="mcp-token-meta">{tokenMeta(t)}</div>
          </div>
          {t.status !== "revoked" && (
            <div className="mcp-token-actions">
              <Button color="secondary" size="sm" isDisabled={busyId === t.id || verifyingRotation?.id === t.id} isLoading={busyId === t.id} onClick={() => rotate(t)}>{tr("mcp.tokens.rotate")}</Button>
              <Button color="link-destructive" size="sm" isDisabled={busyId === t.id} onClick={() => revoke(t)}>{tr("mcp.tokens.revoke")}</Button>
            </div>
          )}
          {verifyingRotation?.id === t.id && (
            <div className="mcp-token-verify">
              <p>
                {tr("mcp.tokens.rotating", { name: t.name })}
                {turnstileSiteKey && ` ${tr("mcp.tokens.completeCheck")}`}
              </p>
              {turnstileSlot(setRotationHumanToken)}
              <div className="mcp-token-verify-actions">
                <Button size="sm" isDisabled={!verificationOff && !rotationHumanToken} onClick={() => rotateVerified(t, rotationHumanToken)}>{tr("mcp.tokens.rotateToken")}</Button>
                <Button color="secondary" size="sm" onClick={() => setVerifyingRotation(null)}>{tr("common.cancel")}</Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
