import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { build } from "esbuild";

const entry = fileURLToPath(new URL("../src/routes/auth.ts", import.meta.url));
const [{ text: bundledWorker }] = (await build({
  entryPoints: [entry],
  bundle: true,
  format: "esm",
  platform: "neutral",
  write: false,
})).outputFiles;
const { authRouter: app } = await import(`data:text/javascript;base64,${Buffer.from(bundledWorker).toString("base64")}`);

function databaseThatMustNotBeQueried() {
  return new Proxy({}, {
    get() {
      assert.fail("disabled password login must return before querying D1");
    },
  });
}

async function expectLoginDisabled(bindings) {
  const response = await app.request("http://untrusted.example/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Host: "localhost", "X-Forwarded-Proto": "http" },
    body: JSON.stringify({ email: "dev@example.com", password: "password" }),
  }, { AUTH_MODE: "cookie", DB: databaseThatMustNotBeQueried(), ...bindings });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "Not found" });
}

test("password login fails closed when its configuration is absent", async () => {
  await expectLoginDisabled({});
});

test("production cannot enable password login", async () => {
  await expectLoginDisabled({ ENVIRONMENT: "production", ENABLE_DEV_PASSWORD_LOGIN: "true" });
});

test("checked-in production configuration explicitly disables password login", async () => {
  const toml = await readFile(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /^ENVIRONMENT = "production"$/m);
  assert.match(toml, /^ENABLE_DEV_PASSWORD_LOGIN = "false"$/m);
});
