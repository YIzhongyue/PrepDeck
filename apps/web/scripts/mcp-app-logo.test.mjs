import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";

const { mcpAppLogo, mcpAppInitial } = await importTs(new URL("../src/lib/mcpAppLogo.ts", import.meta.url));
const chatgpt = { clientId: "https://chatgpt.com/oauth/client.json", clientName: "ChatGPT", clientKind: "metadata_document" };

test("only documented exact metadata-document identities receive local artwork", () => {
  assert.equal(mcpAppLogo(chatgpt), "/app-logos/openai.png");
  for (const [clientId, clientName, logo] of [
    ["https://chatgpt.com/oauth/codex/client.json", "Codex", "/app-logos/openai.png"],
    ["https://claude.ai/oauth/mcp-oauth-client-metadata", "Claude", "/app-logos/claude.svg"],
    ["https://claude.ai/oauth/claude-code-client-metadata", "Claude Code", "/app-logos/claude.svg"],
    ["https://vscode.dev/oauth/client-metadata.json", "Visual Studio Code", "/app-logos/vscode.png"],
    ["https://insiders.vscode.dev/oauth/client-metadata.json", "Visual Studio Code", "/app-logos/vscode.png"],
    ["https://github.com/copilot/cli/client-metadata.json", "GitHub Copilot CLI", "/app-logos/github-copilot.svg"],
  ]) assert.equal(mcpAppLogo({ clientId, clientName, clientKind: "metadata_document" }), logo, clientId);
});

test("missing, ambiguous, dynamic, and misleading client metadata retain initials", () => {
  for (const override of [
    { clientKind: "dynamic" }, { clientKind: undefined },
    { clientName: null }, { clientName: "" }, { clientName: " " }, { clientName: "Claude" },
    { clientName: "ChatGPT official" }, { clientName: "chatgpt" },
    { clientId: null }, { clientId: "" }, { clientId: "pdc_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
    { clientId: "https://example.test/oauth/client.json" },
    { clientId: "https://chatgpt.com.evil.test/oauth/client.json" },
    { clientId: "https://chatgpt.com@evil.test/oauth/client.json" },
    { clientId: "http://chatgpt.com/oauth/client.json" },
    { clientId: "https://chatgpt.com/oauth/client.json?client=other" },
    { clientId: "https://chatgpt.com/oauth/client.json#other" },
    { clientId: "https://chatgpt.com/oauth/client.json/" },
    { clientId: "https://chatgpt.com/oauth/codex/client.json" },
    // A known ID with another known app's name, and the other apps' near-misses.
    { clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata" },
    { clientId: "https://claude.ai/oauth/claude-code-client-metadata", clientName: "Claude" },
    { clientId: "https://claude.ai/oauth/mcp-oauth-client-metadata", clientName: "Claude", clientKind: "dynamic" },
    { clientId: "https://claude.ai/oauth/client-metadata", clientName: "Claude" },
    { clientId: "https://vscode.dev/oauth/client-metadata.json", clientName: "GitHub Copilot" },
    { clientId: "https://vscode.dev.evil.test/oauth/client-metadata.json", clientName: "Visual Studio Code" },
    { clientId: "https://github.com/copilot/cli/client-metadata.json", clientName: "GitHub Copilot" },
    { clientId: "pdc_cursor_test_only", clientName: "Cursor", clientKind: "dynamic" },
  ]) assert.equal(mcpAppLogo({ ...chatgpt, ...override }), null, JSON.stringify(override));
  for (const name of [null, undefined, "", "   "]) assert.equal(mcpAppInitial(name), "?");
  assert.equal(mcpAppInitial(" unknown app "), "U");
  assert.equal(mcpAppInitial("ChatGPT"), "C");
});
