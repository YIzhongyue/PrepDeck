// Issue #102 — how an OAuth-capable MCP client becomes known to PrepDeck.
//
// Two onboarding mechanisms are supported, because MCP clients differ:
//
//  - Client ID Metadata Documents (the MCP 2025-11-25 authorization spec's
//    preferred mechanism): the client_id is an https URL serving the client's
//    metadata. PrepDeck fetches it (bounded size and time, no redirects) and
//    caches it in mcp_oauth_clients.
//  - Dynamic Client Registration (RFC 7591), which most MCP clients released
//    before that spec still rely on: POST /api/oauth/register returns a
//    PrepDeck-issued client_id.
//
// Pre-registration is not offered: there is no admin surface for it, and
// every client here is a public client (no secret, PKCE required). Client
// names are self-asserted either way; the consent screen says so.

import type { Env } from "../../bindings";

export type OAuthClientKind = "dynamic" | "metadata_document";

export interface OAuthClient {
  id: string;
  kind: OAuthClientKind;
  name: string | null;
  uri: string | null;
  redirectUris: string[];
}

interface ClientRow {
  id: string;
  kind: OAuthClientKind;
  client_name: string | null;
  client_uri: string | null;
  redirect_uris_json: string;
  fetched_at: number | null;
}

const MAX_REDIRECT_URIS = 10;
const MAX_URI_LENGTH = 2000;
const MAX_CLIENT_NAME_LENGTH = 100;
// A metadata document is re-fetched after an hour; a stale copy is still used
// for up to a day when its host is unreachable, so a brief outage of the
// client's website does not break reconnecting.
const METADATA_REFRESH_MS = 60 * 60 * 1000;
const METADATA_STALE_LIMIT_MS = 24 * 60 * 60 * 1000;
const METADATA_MAX_BYTES = 5 * 1024;
const METADATA_TIMEOUT_MS = 5000;

const FORBIDDEN_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "ftp:", "ws:", "wss:"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A redirect URI a client may register (RFC 6749 §3.1.2, RFC 8252, OAuth 2.1):
 * an absolute https URL; http only on a loopback host (native apps); or a
 * private-use scheme such as `cursor://` for a desktop client. Never a
 * fragment, credentials, or a scheme a browser would execute or render.
 */
export function validRedirectUri(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > MAX_URI_LENGTH) return null;
  // eslint-disable-next-line no-control-regex -- control characters are what it rejects
  if (/[\u0000- \u007f\\]/.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.hash || value.includes("#") || url.username || url.password) return null;
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return null;
  if (url.protocol === "http:" && !LOOPBACK_HOSTS.has(url.hostname)) return null;
  if (url.protocol === "https:" && !url.hostname) return null;
  if (!/^[a-z][a-z0-9+.-]*:$/.test(url.protocol)) return null;
  return value;
}

/**
 * Exact string match against the registered URIs, except that a loopback http
 * redirect may use any port (RFC 8252 §7.3): native clients pick a free port
 * at run time.
 */
export function redirectUriAllowed(registered: readonly string[], requested: string): boolean {
  if (registered.includes(requested)) return true;
  let target: URL;
  try { target = new URL(requested); } catch { return false; }
  if (target.protocol !== "http:" || !LOOPBACK_HOSTS.has(target.hostname)) return false;
  return registered.some((candidate) => {
    let url: URL;
    try { url = new URL(candidate); } catch { return false; }
    return url.protocol === "http:" && url.hostname === target.hostname && url.pathname === target.pathname && url.search === target.search;
  });
}

/** What the consent screen shows as the redirect destination. */
export function redirectTarget(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.protocol === "https:" || url.protocol === "http:" ? url.host : url.protocol.slice(0, -1);
}

function cleanName(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  // eslint-disable-next-line no-control-regex -- control characters are what it strips
  const name = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (name.length > MAX_CLIENT_NAME_LENGTH) return undefined;
  return name || null;
}

function cleanUri(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > MAX_URI_LENGTH) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function redirectUris(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REDIRECT_URIS) return null;
  const uris = value.map(validRedirectUri);
  return uris.every((uri): uri is string => uri !== null) ? [...new Set(uris)] : null;
}

function toClient(row: ClientRow): OAuthClient {
  let uris: unknown;
  try { uris = JSON.parse(row.redirect_uris_json); } catch { uris = []; }
  return {
    id: row.id, kind: row.kind, name: row.client_name, uri: row.client_uri,
    redirectUris: Array.isArray(uris) ? uris.filter((uri): uri is string => typeof uri === "string") : [],
  };
}

export type RegistrationResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; error: "invalid_redirect_uri" | "invalid_client_metadata"; description: string };

/** RFC 7591 registration of a public client. Self-asserted metadata only. */
export async function registerDynamicClient(db: D1Database, metadata: unknown): Promise<RegistrationResult> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return { ok: false, error: "invalid_client_metadata", description: "The registration body must be a JSON object." };
  }
  const input = metadata as Record<string, unknown>;
  const uris = redirectUris(input.redirect_uris);
  if (!uris) {
    return { ok: false, error: "invalid_redirect_uri", description: `redirect_uris must list 1-${MAX_REDIRECT_URIS} https, loopback http or private-use scheme URIs without fragments.` };
  }
  const name = cleanName(input.client_name);
  const uri = cleanUri(input.client_uri);
  if (name === undefined || uri === undefined) {
    return { ok: false, error: "invalid_client_metadata", description: "client_name or client_uri is not valid." };
  }
  const grantTypes = input.grant_types ?? ["authorization_code", "refresh_token"];
  if (!Array.isArray(grantTypes) || !grantTypes.includes("authorization_code")
    || grantTypes.some((type) => type !== "authorization_code" && type !== "refresh_token")) {
    return { ok: false, error: "invalid_client_metadata", description: "Only the authorization_code and refresh_token grant types are supported." };
  }
  const responseTypes = input.response_types ?? ["code"];
  if (!Array.isArray(responseTypes) || responseTypes.some((type) => type !== "code")) {
    return { ok: false, error: "invalid_client_metadata", description: "Only the code response type is supported." };
  }
  // Every client is public. A request for client_secret_basic/post is
  // answered with "none" (RFC 7591 §3.2.1 lets the server replace values)
  // rather than refused, which is what most MCP clients cope with.
  const id = `pdc_${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  const now = Date.now();
  await db.prepare(`
    INSERT INTO mcp_oauth_clients (id, kind, client_name, client_uri, redirect_uris_json, created_at)
    VALUES (?, 'dynamic', ?, ?, ?, ?)
  `).bind(id, name, uri, JSON.stringify(uris), now).run();
  return {
    ok: true,
    body: {
      client_id: id, client_id_issued_at: Math.floor(now / 1000),
      ...(name ? { client_name: name } : {}), ...(uri ? { client_uri: uri } : {}),
      redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

/**
 * A client_id that names a Client ID Metadata Document: an https URL with a
 * path, on a DNS host (no IP literal or localhost), default port, no
 * credentials, query or fragment.
 */
export function isMetadataDocumentClientId(value: string): boolean {
  if (!value.startsWith("https://") || value.length > MAX_URI_LENGTH) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.href !== value || url.username || url.password || url.search || url.hash || url.port) return false;
  // The Worker fetches this URL, so it must name a public DNS host: no IP
  // literal (the WHATWG parser already turns numeric forms such as
  // "https://2130706433/" into dotted IPv4, which the href check above then
  // refuses as non-canonical), no localhost or single-label/internal names,
  // and no trailing-dot spelling that would dodge these checks.
  const host = url.hostname;
  if (url.pathname === "/" || host.endsWith(".") || host === "localhost" || host.endsWith(".localhost")) return false;
  if (/^\d+(\.\d+){3}$/.test(host) || host.startsWith("[")) return false;
  if (/\.(internal|local|lan|home|corp|intranet|private)$/.test(host)) return false;
  return host.includes(".");
}

async function readBounded(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > METADATA_MAX_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes); } catch { return null; }
}

// The token endpoint authentication methods PrepDeck accepts: every client is
// public, so only "none" (routes.ts advertises the same list).
export const TOKEN_ENDPOINT_AUTH_METHODS = ["none"] as const;

/**
 * Whether a metadata document's client can authenticate at the token endpoint
 * the way PrepDeck requires. A token_endpoint_auth_methods_supported list
 * decides when present (issue #109: Codex lists ["none", "private_key_jwt"]
 * while preferring private_key_jwt); a single token_endpoint_auth_method
 * otherwise, absent meaning "none" by default.
 */
export function supportsPublicTokenAuth(document: Record<string, unknown>): boolean {
  const accepted: readonly unknown[] = TOKEN_ENDPOINT_AUTH_METHODS;
  const methods = document.token_endpoint_auth_methods_supported;
  if (methods !== undefined) {
    return Array.isArray(methods) && methods.every((method) => typeof method === "string")
      && methods.some((method) => accepted.includes(method));
  }
  const method = document.token_endpoint_auth_method;
  return method === undefined || accepted.includes(method);
}

async function fetchMetadataDocument(clientId: string): Promise<{ name: string | null; uri: string | null; redirectUris: string[] } | null> {
  let response: Response;
  try {
    response = await fetch(clientId, {
      headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const text = await readBounded(response);
  if (text === null) return null;
  let document: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    document = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  // The document must name itself, or any URL could claim another's identity.
  if (document.client_id !== clientId) return null;
  if (!supportsPublicTokenAuth(document)) return null;
  const uris = redirectUris(document.redirect_uris);
  const name = cleanName(document.client_name);
  const uri = cleanUri(document.client_uri);
  if (!uris || name === undefined || uri === undefined) return null;
  return { name, uri, redirectUris: uris };
}

async function storedClient(db: D1Database, clientId: string): Promise<ClientRow | null> {
  return db.prepare("SELECT id, kind, client_name, client_uri, redirect_uris_json, fetched_at FROM mcp_oauth_clients WHERE id = ?")
    .bind(clientId).first<ClientRow>();
}

/**
 * The client an authorization request names, fetching (or refreshing) its
 * metadata document when the client_id is a URL. Null for an unknown id or a
 * document that cannot be fetched and validated.
 */
export async function resolveClient(env: Pick<Env, "DB">, clientId: string): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > MAX_URI_LENGTH) return null;
  const row = await storedClient(env.DB, clientId);
  if (!isMetadataDocumentClientId(clientId)) return row && row.kind === "dynamic" ? toClient(row) : null;

  const now = Date.now();
  if (row && row.fetched_at !== null && now - row.fetched_at < METADATA_REFRESH_MS) return toClient(row);
  const fetched = await fetchMetadataDocument(clientId);
  if (!fetched) {
    return row && row.fetched_at !== null && now - row.fetched_at < METADATA_STALE_LIMIT_MS ? toClient(row) : null;
  }
  await env.DB.prepare(`
    INSERT INTO mcp_oauth_clients (id, kind, client_name, client_uri, redirect_uris_json, created_at, fetched_at)
    VALUES (?, 'metadata_document', ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET client_name = excluded.client_name, client_uri = excluded.client_uri,
      redirect_uris_json = excluded.redirect_uris_json, fetched_at = excluded.fetched_at
  `).bind(clientId, fetched.name, fetched.uri, JSON.stringify(fetched.redirectUris), now, now).run();
  return { id: clientId, kind: "metadata_document", ...fetched };
}

/** The stored client, without fetching: token requests only follow an authorization that already resolved it. */
export async function getStoredClient(db: D1Database, clientId: string): Promise<OAuthClient | null> {
  if (!clientId || clientId.length > MAX_URI_LENGTH) return null;
  const row = await storedClient(db, clientId);
  return row ? toClient(row) : null;
}
