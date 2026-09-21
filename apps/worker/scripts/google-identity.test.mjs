// implementation — dedicated coverage for FR-1.9: lib/authorizeIdentity.ts
// resolves a returning Google user by the OIDC `sub` claim rather than by
// email, binds that subject to a pre-existing email-identified account exactly
// once, and refuses to merge two accounts whose addresses happen to collide.
// Same D1/KV shim shape as the other scripts/*.test.mjs fixtures (see
// google-avatar.test.mjs).
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

const migration = (name) => readFileSync(new URL(`../../../migrations/${name}`, import.meta.url), "utf8");

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
  return {
    store,
    get: async (key) => (store.has(key) ? JSON.parse(store.get(key)) : null),
    put: async (key, value) => store.set(key, value),
    delete: async (key) => store.delete(key),
  };
}

function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  sqlite.exec(migration("0001_init.sql"));
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

const google = (subject, email = "alice@example.test") => ({ provider: "google", subject, email });
const profile = (overrides = {}) => async () => ({ name: "Alice", picture: null, ...overrides });
const userRow = (sqlite, id = "user-1") =>
  ({ ...sqlite.prepare("SELECT id, email, google_sub, status FROM users WHERE id = ?").get(id) });

test("a first Google sign-in binds the verified subject to the invited account", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite);

  const result = await authorizeIdentity(env, google("110000000000000000001"), profile());

  assert.equal(result.ok, true);
  assert.equal(result.user.id, "user-1");
  assert.deepEqual(userRow(sqlite), {
    id: "user-1", email: "alice@example.test", google_sub: "110000000000000000001", status: "active",
  });
});

test("an account identified only by email is migrated to its subject on the next sign-in", async (t) => {
  const { sqlite, env } = fixture(t);
  // Already active from before this change, and with nothing left to backfill,
  // so the migration must not depend on the first-sign-in activation branch.
  insertUser(sqlite, { status: "active", display_name: "Alice", avatar_url: "/custom.png" });
  let getProfileCalls = 0;

  const result = await authorizeIdentity(env, google("110000000000000000001"), async () => {
    getProfileCalls += 1;
    return { name: "Alice", picture: null };
  });

  assert.equal(result.ok, true);
  assert.equal(result.user.id, "user-1");
  assert.equal(userRow(sqlite).google_sub, "110000000000000000001");
  assert.equal(getProfileCalls, 0);
});

test("a returning user is resolved by subject even when the email no longer matches", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite, {
    status: "active", google_sub: "110000000000000000001", display_name: "Alice", avatar_url: "/custom.png",
  });

  const result = await authorizeIdentity(env, google("110000000000000000001", "alice@newdomain.test"), profile());

  assert.equal(result.ok, true);
  assert.equal(result.user.id, "user-1");
  // One account, not two: the rename follows the existing row rather than
  // stranding its attempts, bookmarks and notes behind the old address.
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
  assert.equal(userRow(sqlite).email, "alice@newdomain.test");
  assert.equal(result.user.email, "alice@newdomain.test");
});

test("a rename onto an address another account holds is dropped, not merged", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite, {
    status: "active", google_sub: "110000000000000000001", display_name: "Alice", avatar_url: "/custom.png",
  });
  insertUser(sqlite, { id: "user-2", email: "bob@example.test", status: "active", display_name: "Bob", avatar_url: "/bob.png" });

  const result = await authorizeIdentity(env, google("110000000000000000001", "bob@example.test"), profile());

  // Still Alice's account — the subject decided that — but her stored address
  // stays put rather than colliding with Bob's row.
  assert.equal(result.ok, true);
  assert.equal(result.user.id, "user-1");
  assert.equal(userRow(sqlite).email, "alice@example.test");
  assert.deepEqual(userRow(sqlite, "user-2"), {
    id: "user-2", email: "bob@example.test", google_sub: null, status: "active",
  });
});

test("an account bound to a different subject is not rebound by a matching email", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite, {
    status: "active", google_sub: "110000000000000000001", display_name: "Alice", avatar_url: "/custom.png",
  });

  // Same address, different Google account: a recycled or re-created identity,
  // which must not inherit the existing account's data.
  const result = await authorizeIdentity(env, google("220000000000000000002"), profile());

  assert.equal(result.ok, false);
  assert.equal(result.email, "alice@example.test");
  assert.equal(userRow(sqlite).google_sub, "110000000000000000001");
});

test("a subject with no invitation behind it is denied", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite, { status: "active", display_name: "Alice", avatar_url: "/custom.png" });

  const result = await authorizeIdentity(env, google("220000000000000000002", "stranger@example.test"), profile());

  assert.equal(result.ok, false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM users").get().n, 1);
});

test("a revoked account is denied even when its subject matches", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite, { status: "revoked", google_sub: "110000000000000000001", avatar_url: "/custom.png" });
  let getProfileCalls = 0;

  const result = await authorizeIdentity(env, google("110000000000000000001"), async () => {
    getProfileCalls += 1;
    return { name: "Alice", picture: null };
  });

  assert.equal(result.ok, false);
  assert.equal(getProfileCalls, 0);
});

test("the cache entry under a replaced address is dropped on rename", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite, {
    status: "active", google_sub: "110000000000000000001", display_name: "Alice", avatar_url: "/custom.png",
  });

  await authorizeIdentity(env, google("110000000000000000001", "alice@newdomain.test"), profile());

  assert.equal(env.KV.store.has("user-cache:email:alice@example.test"), false);
  assert.equal(env.KV.store.has("user-cache:email:alice@newdomain.test"), true);
  assert.equal(env.KV.store.has("user-cache:id:user-1"), true);
});

test("a Cloudflare Access subject is never stored as a Google subject", async (t) => {
  const { sqlite, env } = fixture(t);
  insertUser(sqlite);

  // Access mints its own subject for the same person; storing it would later
  // read as "already bound to another Google account" and lock the user out.
  const result = await authorizeIdentity(
    env,
    { provider: "cloudflare-access", subject: "6a1f0e2c-0000-4000-8000-000000000000", email: "alice@example.test" },
    profile()
  );

  assert.equal(result.ok, true);
  assert.deepEqual(userRow(sqlite), {
    id: "user-1", email: "alice@example.test", google_sub: null, status: "active",
  });
});

test("0032 clears provider subjects that cannot be Google subjects", async (t) => {
  const { sqlite } = fixture(t);
  insertUser(sqlite, { status: "active", google_sub: "110000000000000000001" });
  insertUser(sqlite, { id: "user-2", email: "bob@example.test", status: "active", google_sub: "6a1f0e2c-0000-4000-8000-000000000000" });

  sqlite.exec(migration("0032_google_sub_identity.sql"));

  assert.equal(userRow(sqlite).google_sub, "110000000000000000001");
  // Cleared, so bob's next Google sign-in re-arms the one-time email rebind
  // instead of being read as a conflicting binding.
  assert.equal(userRow(sqlite, "user-2").google_sub, null);
});
