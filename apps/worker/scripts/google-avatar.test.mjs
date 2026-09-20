// implementation — dedicated coverage for lib/authorizeIdentity.ts's handling of
// the Google `picture` claim: populated on first activation, backfilled on a
// later sign-in if still unset, and never clobbered once set (Google-sourced
// or a custom upload). Same D1/KV shim shape as the other scripts/*.test.mjs
// fixtures (see question-bank-tags.test.mjs's d1()).
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";

async function bundle(path) {
  const { outputFiles } = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"],
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const { authorizeIdentity } = await bundle("../src/lib/authorizeIdentity.ts");

function d1(sqlite) {
  return {
    prepare(sql) {
      const methodsFor = (args) => ({
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
        run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      });
      return { bind: (...args) => methodsFor(args), ...methodsFor([]) };
    },
  };
}

function kv() {
  const store = new Map();
  return { get: async (key) => (store.has(key) ? JSON.parse(store.get(key)) : null), put: async (key, value) => store.set(key, value), delete: async (key) => store.delete(key) };
}

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(readFileSync(new URL("../../../migrations/0001_init.sql", import.meta.url), "utf8"));
  const env = { DB: d1(sqlite), KV: kv() };
  return { sqlite, env };
}

function insertUser(sqlite, overrides = {}) {
  const row = {
    id: "user-1", email: "alice@example.test", google_sub: null, display_name: null, avatar_url: null,
    role: "user", status: "invited", created_at: "2026-01-01T00:00:00.000Z", ...overrides,
  };
  sqlite.prepare(
    "INSERT INTO users (id, email, google_sub, display_name, avatar_url, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(row.id, row.email, row.google_sub, row.display_name, row.avatar_url, row.role, row.status, row.created_at);
  return row;
}

test("first sign-in stores the Google picture claim as the avatar", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite);

  const result = await authorizeIdentity(env, "alice@example.test", async () => ({
    sub: "google-sub-1", name: "Alice", picture: "https://lh3.googleusercontent.com/alice.jpg",
  }));

  assert.equal(result.ok, true);
  assert.equal(result.user.avatarUrl, "https://lh3.googleusercontent.com/alice.jpg");
  const row = sqlite.prepare("SELECT status, avatar_url FROM users WHERE id = ?").get("user-1");
  assert.equal(row.status, "active");
  assert.equal(row.avatar_url, "https://lh3.googleusercontent.com/alice.jpg");
});

test("first sign-in without a picture claim activates with no avatar and does not fail login", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite);

  const result = await authorizeIdentity(env, "alice@example.test", async () => ({
    sub: "google-sub-1", name: "Alice", picture: null,
  }));

  assert.equal(result.ok, true);
  assert.equal(result.user.avatarUrl, null);
  const row = sqlite.prepare("SELECT status, avatar_url FROM users WHERE id = ?").get("user-1");
  assert.equal(row.status, "active");
  assert.equal(row.avatar_url, null);
});

test("a later sign-in backfills the avatar for an already-active user that has none", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite, { status: "active", google_sub: "google-sub-1", display_name: "Alice", avatar_url: null });

  const result = await authorizeIdentity(env, "alice@example.test", async () => ({
    sub: "google-sub-1", name: "Alice", picture: "https://lh3.googleusercontent.com/alice-new.jpg",
  }));

  assert.equal(result.ok, true);
  assert.equal(result.user.avatarUrl, "https://lh3.googleusercontent.com/alice-new.jpg");
  const row = sqlite.prepare("SELECT avatar_url FROM users WHERE id = ?").get("user-1");
  assert.equal(row.avatar_url, "https://lh3.googleusercontent.com/alice-new.jpg");
});

test("an active user's existing avatar is never overwritten by a later sign-in", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite, {
    status: "active", google_sub: "google-sub-1", display_name: "Alice",
    avatar_url: "https://cdn.example.test/custom-avatar.png",
  });
  let getProfileCalls = 0;

  const result = await authorizeIdentity(env, "alice@example.test", async () => {
    getProfileCalls += 1;
    return { sub: "google-sub-1", name: "Alice", picture: "https://lh3.googleusercontent.com/alice-new.jpg" };
  });

  assert.equal(result.ok, true);
  assert.equal(result.user.avatarUrl, "https://cdn.example.test/custom-avatar.png");
  // No avatar left to backfill, so the (potentially network-bound) profile
  // lookup should be skipped entirely on this sign-in.
  assert.equal(getProfileCalls, 0);
  const row = sqlite.prepare("SELECT avatar_url FROM users WHERE id = ?").get("user-1");
  assert.equal(row.avatar_url, "https://cdn.example.test/custom-avatar.png");
});

test("a revoked user is denied without ever fetching a profile", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite, { status: "revoked", avatar_url: null });
  let getProfileCalls = 0;

  const result = await authorizeIdentity(env, "alice@example.test", async () => {
    getProfileCalls += 1;
    return { sub: "google-sub-1", name: "Alice", picture: "https://lh3.googleusercontent.com/alice.jpg" };
  });

  assert.equal(result.ok, false);
  assert.equal(getProfileCalls, 0);
});
