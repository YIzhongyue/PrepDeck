import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";

const { mcpAppLogo, mcpAppInitial } = await importTs(new URL("../src/lib/mcpAppLogo.ts", import.meta.url));
const chatgpt = { clientId: "https://chatgpt.com/oauth/client.json", clientName: "ChatGPT", clientKind: "metadata_document" };

test("only documented exact metadata-document identities receive local artwork", () => {
  assert.equal(mcpAppLogo(chatgpt), "/app-logos/openai.png");
  assert.equal(mcpAppLogo({ ...chatgpt, clientId: "https://chatgpt.com/oauth/codex/client.json", clientName: "Codex" }), "/app-logos/openai.png");
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
  ]) assert.equal(mcpAppLogo({ ...chatgpt, ...override }), null, JSON.stringify(override));
  for (const name of [null, undefined, "", "   "]) assert.equal(mcpAppInitial(name), "?");
  assert.equal(mcpAppInitial(" unknown app "), "U");
  assert.equal(mcpAppInitial("ChatGPT"), "C");
});
