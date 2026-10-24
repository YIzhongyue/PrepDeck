import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";
import { openDatabase } from "../../../tests/support/migrations.mjs";
import { createD1 } from "../../../tests/support/d1.mjs";

const { requestedScopes, resolveClient, issueMcpCredential, authenticateMcp } = await importTs([
  new URL("../src/mcp/oauth/config.ts", import.meta.url),
  new URL("../src/mcp/oauth/clients.ts", import.meta.url),
  new URL("../src/mcp/credentials.ts", import.meta.url),
]);
const DAY = 86_400_000;
const CLIENT = "https://client.example/metadata.json";
function setup(t) {
  const sqlite = openDatabase(t);
  sqlite.prepare("INSERT INTO users (id, email, role, status, created_at) VALUES ('alice', 'alice@example.test', 'user', 'active', '2026-10-23')").run();
  return { sqlite, DB: createD1(sqlite) };
}

test("MCP scope policy rejects unsupported explicit scopes and defaults to read only", () => {
  for (const audience of ["user", "admin"]) {
    assert.deepEqual(requestedScopes(undefined, audience), [`mcp:${audience}:read`]);
    assert.deepEqual(requestedScopes("", audience), [`mcp:${audience}:read`]);
    assert.equal(requestedScopes("typo:read", audience), null);
    assert.equal(requestedScopes(`mcp:${audience}:read typo:write`, audience), null);
    assert.deepEqual(requestedScopes(`mcp:${audience}:write`, audience), [`mcp:${audience}:write`]);
  }
});

test("metadata discovery denies unconfigured, malformed and nonexact allowlists before network or cache", async (t) => {
  const { DB, sqlite } = setup(t);
  const priorFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = priorFetch; });
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return Response.json({ client_id: CLIENT, redirect_uris: ["https://client.example/callback"] }); };
  for (const allowlist of [undefined, "", "not-json", "{}", '["https://client.example"]', '["https://*.example/metadata.json"]', '[42]']) {
    assert.equal(await resolveClient({ DB, MCP_OAUTH_METADATA_CLIENT_ALLOWLIST: allowlist }, CLIENT), null);
  }
  assert.equal(fetches, 0);
  const env = { DB, MCP_OAUTH_METADATA_CLIENT_ALLOWLIST: JSON.stringify([CLIENT]) };
  assert.equal((await resolveClient(env, CLIENT)).id, CLIENT);
  assert.equal(fetches, 1);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM mcp_oauth_clients").get().n, 1);
  assert.equal(await resolveClient({ DB }, CLIENT), null, "removing allowlist blocks new authorization even with cached metadata");
  assert.equal(fetches, 1);
});

test("new PATs expire by default and reject overlong lifetimes; existing legacy PAT still authenticates", async (t) => {
  const { DB, sqlite } = setup(t);
  for (const expiresAt of [undefined, null]) {
    const before = Date.now();
    const result = await issueMcpCredential(DB, { sessionVersion: 0, userId: "alice", audience: "user", name: "default", expiresAt });
    assert.ok(result.expiresAt >= before + 30 * DAY && result.expiresAt <= Date.now() + 30 * DAY);
  }
  await assert.rejects(issueMcpCredential(DB, { sessionVersion: 0, userId: "alice", audience: "user", name: "too-long", expiresAt: Date.now() + 91 * DAY }));
  const legacy = await issueMcpCredential(DB, { sessionVersion: 0, userId: "alice", audience: "user", name: "legacy" });
  sqlite.prepare("UPDATE mcp_credentials SET expires_at = NULL WHERE id = ?").run(legacy.id);
  const principal = await authenticateMcp(new Request("https://prepdeck.test/mcp", { headers: { Authorization: `Bearer ${legacy.token}` } }), { DB }, "user");
  assert.equal(principal.userId, "alice");
});
