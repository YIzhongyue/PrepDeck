import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { Hono } from "hono";

const { outputFiles } = await build({
  stdin: { contents: `export * from './routes/appearance'; export { requireAccessUser } from './middleware/access'; export { createSessionToken } from './lib/session';`,
    resolveDir: fileURLToPath(new URL("../src/", import.meta.url)), loader: "ts" },
  bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"],
});
const { appearanceRouter, adminAppearanceRouter, requireAccessUser, createSessionToken } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

function fixture(t) {
  const db = new DatabaseSync(":memory:");
  t.after(() => db.close());
  const migrations = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(name, migrations), "utf8"));
  }
  for (const [id, role, status] of [["admin", "admin", "active"], ["user", "user", "active"], ["revoked", "admin", "revoked"]]) {
    db.prepare("INSERT INTO users(id,email,role,status,created_at) VALUES (?,?,?,?,?)").run(id, `${id}@test`, role, status, "2026-10-01");
  }
  const faults = { read: false, write: false };
  const env = { AUTH_MODE: "cookie", SESSION_SECRET: "test-session-secret-for-appearance", KV: { get: async () => null, put: async () => {} },
    DB: { prepare(sql) { let values = []; return {
      bind(...args) { values = args; return this; },
      async first() {
        if (faults.read && sql.includes("site_appearance")) throw new Error("unavailable");
        return db.prepare(sql).get(...values) ?? null;
      },
      async run() {
        if (faults.write) throw new Error("unavailable");
        return { success: true, meta: { changes: Number(db.prepare(sql).run(...values).changes) } };
      },
    }; } },
  };
  // Same public/protected split as index.ts, with the real cookie and role
  // middleware: no header or request-body role can authorize the write.
  function application() {
    const app = new Hono();
    app.route("/api/appearance", appearanceRouter);
    app.use("/api/admin/*", requireAccessUser);
    app.route("/api/admin/appearance", adminAppearanceRouter);
    return app;
  }
  async function request({ style, raw, user, method = style === undefined && raw === undefined ? "GET" : "PUT", publicPath = method === "GET", app = application() } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (user) headers.Cookie = `pd_session=${await createSessionToken(user, 0, env)}`;
    const response = await app.request(`https://test/api/${publicPath ? "" : "admin/"}appearance`, {
      method, headers, body: raw ?? (style === undefined ? undefined : JSON.stringify({ mascotStyle: style })),
    }, env);
    return { status: response.status, cache: response.headers.get("Cache-Control"), body: await response.json().catch(() => null) };
  }
  return { request, faults, db };
}

test("anonymous reads expose only the style; admin writes persist across app instances and users", async t => {
  const { request, db } = fixture(t);
  assert.deepEqual(await request(), { status: 200, cache: "no-store", body: { mascotStyle: "3D-Chibi" } });
  for (const style of ["2D-Anime", "3D-Chibi", "2D-Anime"]) {
    assert.equal((await request({ style, user: "admin" })).status, 200);
    for (const user of [undefined, "admin", "user"]) {
      assert.deepEqual((await request({ user })).body, { mascotStyle: style });
    }
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM site_appearance").get().n, 1);
});

test("unauthenticated, nonadmin and revoked users cannot change the global setting", async t => {
  const { request } = fixture(t);
  for (const [user, status] of [[undefined, 401], ["user", 403], ["revoked", 403]]) {
    assert.equal((await request({ style: "2D-Anime", user })).status, status);
  }
  assert.notEqual((await request({ style: "2D-Anime", user: "admin", publicPath: true })).status, 200);
  assert.deepEqual((await request()).body, { mascotStyle: "3D-Chibi" });
});

test("invalid JSON, extra keys, URLs and oversized bodies never alter the saved style", async t => {
  const { request } = fixture(t);
  await request({ style: "2D-Anime", user: "admin" });
  for (const raw of ["{", "null", "[]", "{}", '{"mascotStyle":null}', '{"mascotStyle":"3d-chibi"}',
    '{"mascotStyle":"https://evil.test/x"}', '{"mascotStyle":"3D-Chibi","role":"admin"}']) {
    assert.equal((await request({ raw, user: "admin" })).status, 400, raw);
  }
  assert.equal((await request({ raw: " ".repeat(1025), user: "admin" })).status, 413);
  assert.deepEqual((await request()).body, { mascotStyle: "2D-Anime" });
});

test("database failures return retryable errors, never a false successful save", async t => {
  const { request, faults } = fixture(t);
  faults.write = true;
  assert.equal((await request({ style: "2D-Anime", user: "admin" })).status, 503);
  assert.deepEqual((await request()).body, { mascotStyle: "3D-Chibi" });
  faults.read = true;
  const response = await request();
  assert.equal(response.status, 503);
  assert.equal(response.cache, "no-store");
  faults.read = faults.write = false;
  assert.equal((await request({ style: "2D-Anime", user: "admin" })).status, 200);
});
