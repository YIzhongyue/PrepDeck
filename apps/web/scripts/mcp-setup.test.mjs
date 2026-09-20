import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const { code } = transformSync(readFileSync(new URL("../src/lib/mcpSetupPrompt.ts", import.meta.url), "utf8"), {
  loader: "ts", format: "esm", target: "es2022",
});
const { buildUserMcpSetupPrompt, isFreshMcpSecretUsable, USER_MCP_TOKEN_PLACEHOLDER } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`,
);

test("setup endpoint uses only the active HTTP origin, including a local port", () => {
  for (const [input, origin] of [["https://staging.example.test", "https://staging.example.test"], ["http://localhost:5173/settings?tab=mcp#tokens", "http://localhost:5173"]]) {
    const prompt = buildUserMcpSetupPrompt(input);
    assert.match(prompt, new RegExp(`Endpoint: ${origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/mcp\\n`));
    assert.ok(prompt.includes(`Authorization: Bearer ${USER_MCP_TOKEN_PLACEHOLDER}`));
    assert.doesNotMatch(prompt, /\/api\/mcp-tokens|\/admin-mcp|tab=mcp/);
    assert.match(prompt, /tools\/list/);
    assert.match(prompt, /user_get_identity with \{\}/);
    assert.match(prompt, /configuration saved separately from connection actually verified/);
  }
  for (const origin of ["file:///tmp/settings", "https://user:password@example.test", "not a URL"]) {
    assert.throws(() => buildUserMcpSetupPrompt(origin));
  }
});

test("only explicitly supplied correctly shaped User secrets replace the placeholder", () => {
  const token = `pd_mcp_user_${"a".repeat(64)}`;
  const inclusive = buildUserMcpSetupPrompt("https://example.test", token);
  assert.ok(inclusive.includes(`Authorization: Bearer ${token}`));
  assert.equal(inclusive.split(token).length, 2);
  assert.ok(!inclusive.includes(USER_MCP_TOKEN_PLACEHOLDER));
  assert.ok(buildUserMcpSetupPrompt("https://example.test").includes(USER_MCP_TOKEN_PLACEHOLDER));
  for (const invalid of [`pd_mcp_admin_${"b".repeat(64)}`, "", `${token}\nextra`, "saved-token-id"]) {
    assert.throws(() => buildUserMcpSetupPrompt("https://example.test", invalid), /fresh User MCP token/);
  }
});

test("fresh secret is invalid at its expiry and absent after dismissal", () => {
  const secret = { id: "fresh", token: "fixture", name: "client", expiresAt: 1234 };
  assert.equal(isFreshMcpSecretUsable(secret, 1233), true);
  assert.equal(isFreshMcpSecretUsable(secret, 1234), false);
  assert.equal(isFreshMcpSecretUsable(secret, 1235), false);
  assert.equal(isFreshMcpSecretUsable(null), false);
  assert.equal(isFreshMcpSecretUsable({ ...secret, expiresAt: null }, 9999), true);
});
