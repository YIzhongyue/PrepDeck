// implementation — self-service MCP token lifecycle UI. Shared by Settings'
// "MCP access" card (User MCP, own tokens) and the Admin console's "MCP
// tokens" tab (Admin MCP, gated server-side by requireAdmin) — only the
// `apiBase` and copy differ between the two mounts.

import { useEffect, useRef, useState } from "react";
import { MCP_TOKEN_NAME_MAX_LENGTH, type CreateMcpCredentialResponse, type ListMcpCredentialsResponse, type McpCredentialSummary } from "@prepdeck/shared";
import { apiFetch, ApiError } from "../lib/api";
import { copyText } from "../lib/practicePrompt";
import { buildUserMcpSetupPrompt, isFreshMcpSecretUsable, type FreshMcpSecret } from "../lib/mcpSetupPrompt";
// implementation — shared Untitled UI primitives; docs/guides/ui-components.md.
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { TextArea } from "@/components/base/textarea/textarea";
import "./McpTokensCard.css";

const DANGER = "var(--color-danger)";
const EXPIRY_OPTIONS = [["never", "Never"], ["30", "30 days"], ["90", "90 days"], ["365", "1 year"]] as const;
const STATUS_TAG_CLASS: Record<McpCredentialSummary["status"], string> = { active: "tag-accent-2", revoked: "tag-neutral", expired: "tag-neutral" };

function formatDate(ms: number | null): string {
  return ms === null ? "—" : new Date(ms).toLocaleString();
}

export default function McpTokensCard({
  title, description, apiBase, namePlaceholder, enableSetupPrompt = false
}: {
  title: string;
  description: string;
  apiBase: string;
  namePlaceholder?: string;
  enableSetupPrompt?: boolean;
}) {
  const [tokens, setTokens] = useState<McpCredentialSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [expiresDraft, setExpiresDraft] = useState<(typeof EXPIRY_OPTIONS)[number][0]>("never");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // The freshly issued/rotated token is shown exactly once, then discarded —
  // it is never retrievable again after this card forgets it.
  const [revealed, setRevealed] = useState<FreshMcpSecret | null>(null);
  const revealedRef = useRef<FreshMcpSecret | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [copyOk, setCopyOk] = useState(false);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [copyFallback, setCopyFallback] = useState<{ text: string; label: string } | null>(null);
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

  useEffect(() => {
    let active = true;
    reveal(null);
    setLoadError(null);
    setLoading(true);
    apiFetch<ListMcpCredentialsResponse>(apiBase)
      .then(({ credentials }) => { if (active) setTokens(credentials); })
      .catch(() => { if (active) setLoadError("Could not load tokens."); })
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
    if (!name) { setCreateError("Name is required."); return; }
    setCreateBusy(true);
    setCreateError(null);
    try {
      const expiresInDays = expiresDraft === "never" ? undefined : Number(expiresDraft);
      const { credential, token } = await apiFetch<CreateMcpCredentialResponse>(apiBase, {
        method: "POST", body: JSON.stringify({ name, expiresInDays })
      });
      setTokens((prev) => [credential, ...prev]);
      reveal({ token, id: credential.id, name: credential.name, expiresAt: credential.expiresAt });
      setNameDraft("");
      setExpiresDraft("never");
      setCreating(false);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : "Could not create this token.");
    } finally {
      setCreateBusy(false);
    }
  };

  const revoke = (t: McpCredentialSummary) => {
    if (!window.confirm(`Revoke "${t.name}"? Anything using this token stops working immediately.`)) return;
    if (revealedRef.current?.id === t.id) reveal(null);
    setBusyId(t.id);
    setRowError(null);
    apiFetch(`${apiBase}/${t.id}/revoke`, { method: "POST" })
      .then(() => setTokens((prev) => prev.map((x) => (x.id === t.id ? { ...x, status: "revoked" as const, revokedAt: Date.now() } : x))))
      .catch((err) => setRowError(err instanceof ApiError ? err.message : "Could not revoke this token."))
      .finally(() => setBusyId(null));
  };

  const rotate = (t: McpCredentialSummary) => {
    if (!window.confirm(`Rotate "${t.name}"? The current token stops working immediately and a new one takes its place.`)) return;
    // Rotation can revoke the predecessor even when replacement issuance fails.
    if (revealedRef.current?.id === t.id) reveal(null);
    setBusyId(t.id);
    setRowError(null);
    apiFetch<CreateMcpCredentialResponse>(`${apiBase}/${t.id}/rotate`, { method: "POST" })
      .then(({ credential, token }) => {
        setTokens((prev) => [credential, ...prev.map((x) => (x.id === t.id ? { ...x, status: "revoked" as const, revokedAt: Date.now() } : x))]);
        reveal({ token, id: credential.id, name: credential.name, expiresAt: credential.expiresAt });
      })
      .catch((err) => setRowError(err instanceof ApiError ? err.message : "Could not rotate this token."))
      .finally(() => setBusyId(null));
  };

  const copyValue = async (text: string, label: string, secretId?: string) => {
    const generation = ++copyGeneration.current;
    setCopyOk(false);
    setCopyMessage(null);
    setCopyFallback(null);
    const current = () => generation === copyGeneration.current && (!secretId ||
      (revealedRef.current?.id === secretId && isFreshMcpSecretUsable(revealedRef.current)));
    try {
      await copyText(text);
      if (!current()) return;
      setCopyOk(label === "Token");
      setCopyMessage(`${label} copied.`);
    } catch {
      if (!current()) return;
      setCopyFallback({ text, label });
    }
  };

  const copyToken = () => {
    if (!isFreshMcpSecretUsable(revealedRef.current)) { reveal(null); return; }
    void copyValue(revealedRef.current.token, "Token", revealedRef.current.id);
  };

  const copySetupPrompt = (includeToken: boolean) => {
    if (!userSetupEnabled) return;
    const secret = revealedRef.current;
    if (includeToken && !isFreshMcpSecretUsable(secret)) { reveal(null); return; }
    void copyValue(buildUserMcpSetupPrompt(window.location.origin, includeToken ? secret!.token : undefined),
      "Setup prompt", includeToken ? secret!.id : undefined);
  };

  return (
    <div className="card elev-sm" style={{ padding: 22, gap: 16, marginBottom: 16 }}>
      <div>
        <h3 style={{ margin: "0 0 4px", fontSize: 20 }}>{title}</h3>
        <p style={{ margin: 0, fontSize: 12.5, opacity: 0.7 }}>{description}</p>
      </div>

      {userSetupEnabled && (
        <div className="mcp-setup-actions">
          <Button color="secondary" size="md" className="mcp-setup-button" onClick={() => copySetupPrompt(false)}>Copy setup prompt</Button>
          <p>Paste this into your AI chatbot to connect PrepDeck. Enter your token securely in the client when prompted.</p>
        </div>
      )}

      {revealed && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "15px 16px", borderRadius: 20, background: "var(--color-accent-100)", border: "1.5px solid var(--color-accent-300)" }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Copy &quot;{revealed.name}&quot; now — it won&apos;t be shown again</p>
          <div className="mcp-secret-actions">
            <Input
              className="mcp-secret-field"
              aria-label="New MCP token"
              isReadOnly
              type={showToken ? "text" : "password"}
              value={revealed.token}
              inputClassName={showToken ? "font-mono text-xs" : undefined}
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button color="secondary" size="md" onClick={() => setShowToken((v) => !v)}>{showToken ? "Hide" : "Show"}</Button>
            <Button color="secondary" size="md" onClick={copyToken}>{copyOk ? "Copied" : "Copy"}</Button>
          </div>
          {userSetupEnabled && (
            <div className="mcp-setup-actions">
              <Button color="secondary" size="md" className="mcp-setup-button" onClick={() => copySetupPrompt(true)}>Copy setup prompt with token</Button>
              <p>Includes a secret. Pasting this shares your token with the selected AI service.</p>
            </div>
          )}
          <Button color="link-color" size="sm" className="self-start" onClick={() => reveal(null)}>Done</Button>
        </div>
      )}

      {copyMessage && <p role="status" style={{ margin: 0, fontSize: 12.5 }}>{copyMessage}</p>}
      {copyFallback && (
        <div className="mcp-setup-actions">
          <p role="alert">Could not copy to the clipboard. Select and copy the {copyFallback.label.toLowerCase()} below.</p>
          <TextArea className="mcp-setup-fallback" aria-label={`${copyFallback.label} to copy manually`} isReadOnly
            rows={6} value={copyFallback.text} textAreaClassName="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
        </div>
      )}

      {loadError && <p style={{ margin: 0, fontSize: 13, color: DANGER }}>{loadError}</p>}
      {loading && !loadError && <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>Loading…</p>}

      {!loading && !loadError && tokens.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tokens.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 16, background: "var(--color-neutral-100)", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{t.name}</span>
                  <span className={`tag ${STATUS_TAG_CLASS[t.status]}`}>{t.status}</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--color-text-muted)", marginTop: 3 }}>
                  Created {formatDate(t.createdAt)} · Last used {formatDate(t.lastUsedAt)}
                  {t.expiresAt !== null && <> · Expires {formatDate(t.expiresAt)}</>}
                </div>
              </div>
              {t.status !== "revoked" && (
                <div style={{ display: "flex", gap: 8 }}>
                  <Button color="secondary" size="sm" isDisabled={busyId === t.id} isLoading={busyId === t.id} onClick={() => rotate(t)}>Rotate</Button>
                  <Button color="link-destructive" size="sm" isDisabled={busyId === t.id} onClick={() => revoke(t)}>Revoke</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {!loading && !loadError && tokens.length === 0 && !creating && (
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--color-text-muted)" }}>No tokens yet.</p>
      )}
      {rowError && <p style={{ margin: 0, fontSize: 12, color: DANGER }}>{rowError}</p>}

      {creating ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "14px 15px", borderRadius: 18, background: "var(--color-neutral-100)" }}>
          <Input
            label="Name"
            placeholder={namePlaceholder ?? "e.g. local-cli"}
            maxLength={MCP_TOKEN_NAME_MAX_LENGTH}
            value={nameDraft}
            onChange={(value) => { setNameDraft(value); setCreateError(null); }}
            isInvalid={!!createError}
          />
          <div>
            <span style={{ display: "block", fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Expiration</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {EXPIRY_OPTIONS.map(([id, label]) => {
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
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          {createError && <p style={{ margin: 0, fontSize: 12, color: DANGER }}>{createError}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <Button size="md" isDisabled={createBusy || !nameDraft.trim()} isLoading={createBusy} showTextWhileLoading onClick={create}>
              {createBusy ? "Creating…" : "Create token"}
            </Button>
            <Button color="secondary" size="md" onClick={() => { setCreating(false); setCreateError(null); }}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button color="secondary" size="md" className="self-start" onClick={() => setCreating(true)}>+ Create token</Button>
      )}
    </div>
  );
}
