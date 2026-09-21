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
import { Hono } from "hono";

const { outputFiles } = await build({
  stdin: {
    contents: `export * from './src/lib/authorizeIdentity.ts';
      export * from './src/routes/adminUsers.ts';`,
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
  },
  bundle: true, write: false, platform: "browser", format: "esm", mainFields: ["browser", "module", "main"],
});
const { authorizeIdentity, adminUsersRouter } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);

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

  // The Authorized Users screen's half of the FR-1.9 recovery, mounted behind
  // a stand-in for the auth middleware that would normally populate the actor.
  const app = new Hono();
  app.use("*", async (c, next) => { c.set("user", { id: "admin-1", role: c.req.header("x-role") ?? "admin" }); await next(); });
  app.route("/api/admin/users", adminUsersRouter);
  const patchUser = async (id, body, role) => {
    const res = await app.request(`https://example.test/api/admin/users/${id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", ...(role ? { "x-role": role } : {}) },
      body: JSON.stringify(body),
    }, env);
    return { status: res.status, body: await res.json() };
  };
  return { sqlite, env, patchUser };
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
  // Distinct from a plain denial: the address *is* authorized, so the login
  // screen must not send this person off to ask for another invitation.
  assert.equal(result.reason, "subject_conflict");
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

test("clearing the Google link lets the replaced account be claimed again", async (t) => {
  const { sqlite, env, patchUser } = fixture(t);
  insertUser(sqlite, {
    status: "active", google_sub: "110000000000000000001", display_name: "Alice", avatar_url: "/custom.png",
  });

  // The Workspace-migration case: same person and address, but the Google
  // account behind it was replaced, so its subject is new.
  const replacement = google("220000000000000000002");
  assert.equal((await authorizeIdentity(env, replacement, profile())).reason, "subject_conflict");

  const patched = await patchUser("user-1", { googleSub: null });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.user.googleSub, null);

  const result = await authorizeIdentity(env, replacement, profile());

  assert.equal(result.ok, true);
  // Same row, so every attempt, bookmark and note hanging off this id follows
  // the user to their new Google account.
  assert.equal(result.user.id, "user-1");
  assert.equal(userRow(sqlite).google_sub, "220000000000000000002");
});

test("an Admin can clear a Google link but never choose one", async (t) => {
  const { sqlite, patchUser } = fixture(t);
  insertUser(sqlite, { status: "active", google_sub: "110000000000000000001", avatar_url: "/custom.png" });

  // Accepting a subject here would make taking over an account a matter of
  // typing the right number; only a JWKS-verified sign-in may write one.
  const assigned = await patchUser("user-1", { googleSub: "220000000000000000002" });

  assert.equal(assigned.status, 400);
  assert.equal(userRow(sqlite).google_sub, "110000000000000000001");
});

test("clearing a Google link is admin-only and drops the cached row", async (t) => {
  const { sqlite, env, patchUser } = fixture(t);
  insertUser(sqlite, { status: "active", google_sub: "110000000000000000001", avatar_url: "/custom.png" });
  env.KV.store.set("user-cache:id:user-1", JSON.stringify({ id: "user-1" }));

  assert.equal((await patchUser("user-1", { googleSub: null }, "user")).status, 403);
  assert.equal(userRow(sqlite).google_sub, "110000000000000000001");

  assert.equal((await patchUser("user-1", { googleSub: null })).status, 200);
  assert.equal(env.KV.store.has("user-cache:id:user-1"), false);
});
