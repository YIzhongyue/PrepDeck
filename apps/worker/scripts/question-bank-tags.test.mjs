// implementation — dedicated coverage for lib/questionBankTags.ts's catalog
// identity, resolve/create, and link-diff logic, plus the 0026/0027
// migration backfill from the old tags_json column. Everything else about
// the refactor (rename/merge atomicity, revision guards, cache
// invalidation, admin_list_tags shape) is already covered end-to-end
// through the Admin MCP tools in mcp-foundation.test.mjs; this file exists
// because those pure-ish catalog functions had no direct unit coverage at
// all before implementation.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
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
const {
  normalizeTagName, normalizeTagKey, resolveOrCreateTags, fetchTagIdsForQuestion, fetchTagIdsForQuestions,
  buildTagLinkStatements, buildTagNameResolver, findTagCatalogRowByName, countQuestionsForTag,
  countQuestionsForAnyTag, distinctExamIdsForTags,
} = await bundle("../src/lib/questionBankTags.ts");

const migrationsDir = new URL("../../../migrations/", import.meta.url);
const allMigrations = readdirSync(migrationsDir).filter((n) => n.endsWith(".sql") && n !== "0002_seed_sap_c02_questions.sql").sort();

function applyMigrations(db, names) {
  for (const name of names) db.exec(readFileSync(new URL(name, migrationsDir), "utf8"));
}

// A minimal D1 shim — just enough of prepare/bind/first/all/run/batch for
// the functions under test, same shape as the other scripts/*.test.mjs D1
// fakes (see mcp-foundation.test.mjs's fixture()).
function d1(sqlite) {
  const db = {
    prepare(sql) {
      const methodsFor = (args) => ({
        first: async () => sqlite.prepare(sql).get(...args) ?? null,
        run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...args).changes } }),
        all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
      });
      return { bind: (...args) => methodsFor(args), ...methodsFor([]) };
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return db;
}

function baseFixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  applyMigrations(sqlite, allMigrations);
  sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)").run("examA", "exam-a", "Exam A", "2026-01-01T00:00:00.000Z");
  return { sqlite, db: d1(sqlite) };
}

function insertQuestion(sqlite, id, examId = "examA") {
  sqlite.prepare(
    `INSERT INTO questions (id, exam_id, external_id, sequence_number, type, stem, options_json, correct_answers_json,
       explanation, difficulty, points, created_at, updated_at)
     VALUES (?, ?, NULL, 1, 'fill_blank', 'Stem', NULL, '["x"]', NULL, NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  ).run(id, examId);
}

test("normalizeTagName trims, collapses whitespace, strips a leading #, and rejects invalid input", () => {
  assert.equal(normalizeTagName("  AWS  "), "AWS");
  assert.equal(normalizeTagName("#aws"), "aws");
  assert.equal(normalizeTagName("  #  aws  "), "aws");
  assert.equal(normalizeTagName("a   b"), "a b");
  assert.equal(normalizeTagName(""), null);
  assert.equal(normalizeTagName("   "), null);
  assert.equal(normalizeTagName("#"), null);
  assert.equal(normalizeTagName(42), null);
  assert.equal(normalizeTagName("x".repeat(201)), null);
  assert.equal(normalizeTagName("x".repeat(200)), "x".repeat(200));
});

test("normalizeTagName only folds ASCII whitespace, matching migration 0026's SQL-side normalization exactly (implementation follow-up review)", () => {
  // NBSP (U+00A0) is JS `\s`/`.trim()`-whitespace but NOT ASCII whitespace —
  // migration 0026 has no practical way to fold arbitrary Unicode
  // whitespace in SQL, so normalizeTagName() is deliberately narrowed to
  // the same ASCII-only domain rather than silently diverging from it. A
  // leading/trailing/embedded NBSP must therefore survive as a literal
  // character, not be trimmed or collapsed like a plain space.
  const NBSP = "\u00A0";
  assert.equal(normalizeTagName(`${NBSP}AWS${NBSP}`), `${NBSP}AWS${NBSP}`);
  assert.equal(normalizeTagName(`aws${NBSP}security`), `aws${NBSP}security`);
  // A genuinely blank NBSP-only input is still non-empty text to this
  // function (no ASCII whitespace to strip down to ""), unlike an
  // ASCII-whitespace-only input.
  assert.notEqual(normalizeTagName(NBSP), null);
  // Plain ASCII whitespace (including tab/CR/LF, not just space) still
  // trims and collapses exactly as before.
  assert.equal(normalizeTagName("\tAWS\r\n"), "AWS");
  assert.equal(normalizeTagName("a\t\t b"), "a b");
});

test("normalizeTagKey lower-cases for identity matching", () => {
  assert.equal(normalizeTagKey("AWS"), "aws");
  assert.equal(normalizeTagKey("aws"), "aws");
});

test("resolveOrCreateTags dedupes by normalized key, keeps first-seen display spelling, and registers exactly one row per identity", async (t) => {
  const { sqlite, db } = baseFixture(t);
  const now = "2026-01-01T00:00:00.000Z";
  const resolved = await resolveOrCreateTags(db, ["AWS", "aws", "  Networking  ", "#networking"], now);
  assert.equal(resolved.length, 2, "AWS/aws collapse to one identity, Networking/#networking to another");
  const aws = resolved.find((r) => r.normalizedName === "aws");
  assert.equal(aws.name, "AWS", "first-seen spelling wins for a brand-new row");
  const rows = sqlite.prepare("SELECT normalized_name FROM question_bank_tags ORDER BY normalized_name").all();
  assert.deepEqual(rows.map((r) => r.normalized_name), ["aws", "networking"]);
});

test("resolveOrCreateTags resolves an already-registered tag to its existing id regardless of input casing, never creating a duplicate", async (t) => {
  const { sqlite, db } = baseFixture(t);
  const now = "2026-01-01T00:00:00.000Z";
  const first = await resolveOrCreateTags(db, ["Kubernetes"], now);
  const second = await resolveOrCreateTags(db, ["KUBERNETES"], now);
  assert.equal(second[0].id, first[0].id);
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM question_bank_tags").get().c, 1);
});

test("resolveOrCreateTags ignores invalid names but still resolves the valid ones in the same call", async (t) => {
  const { db } = baseFixture(t);
  const resolved = await resolveOrCreateTags(db, ["", "   ", "#", "valid-tag"], "2026-01-01T00:00:00.000Z");
  assert.deepEqual(resolved.map((r) => r.name), ["valid-tag"]);
});

test("buildTagLinkStatements computes exactly the add/remove diff between current and desired tag ids", async (t) => {
  const { sqlite, db } = baseFixture(t);
  insertQuestion(sqlite, "q1");
  const now = "2026-01-01T00:00:00.000Z";
  const [a, b, c] = await resolveOrCreateTags(db, ["a", "b", "c"], now);
  await db.batch(buildTagLinkStatements(db, "q1", [a.id, b.id], []));
  assert.deepEqual(await fetchTagIdsForQuestion(db, "q1"), [a.id, b.id].sort());

  const statements = buildTagLinkStatements(db, "q1", [b.id, c.id], [a.id, b.id]);
  assert.equal(statements.length, 2, "one add (c) and one remove (a); b is unchanged and produces no statement");
  await db.batch(statements);
  assert.deepEqual([...(await fetchTagIdsForQuestion(db, "q1"))].sort(), [b.id, c.id].sort());
});

test("buildTagLinkStatements with a guard only applies once the guarded question is at exactly that revision", async (t) => {
  const { sqlite, db } = baseFixture(t);
  insertQuestion(sqlite, "q1");
  const [a] = await resolveOrCreateTags(db, ["a"], "2026-01-01T00:00:00.000Z");

  // Guard references a revision the row is NOT at yet — every statement
  // must no-op instead of applying.
  const guardedWrong = buildTagLinkStatements(db, "q1", [a.id], [], { questionId: "q1", revision: 99, updatedAt: "2026-01-01T00:00:00.000Z" });
  await db.batch(guardedWrong);
  assert.deepEqual(await fetchTagIdsForQuestion(db, "q1"), []);

  // The row's revision matches, but updatedAt does NOT — a DIFFERENT
  // concurrent writer could legitimately land the row on this same
  // revision value (it's a small, shared, incrementing counter), so
  // revision alone must never be treated as proof THIS call's own write
  // succeeded. The guard must still no-op.
  const guardedRevisionOnly = buildTagLinkStatements(db, "q1", [a.id], [], { questionId: "q1", revision: 1, updatedAt: "some-other-writer's-timestamp" });
  await db.batch(guardedRevisionOnly);
  assert.deepEqual(await fetchTagIdsForQuestion(db, "q1"), [], "revision matching alone must not be enough to apply the tag-link change");

  // Both the row's actual current revision AND updatedAt match — now the
  // statements apply.
  const guardedRight = buildTagLinkStatements(db, "q1", [a.id], [], { questionId: "q1", revision: 1, updatedAt: "2026-01-01T00:00:00.000Z" });
  await db.batch(guardedRight);
  assert.deepEqual(await fetchTagIdsForQuestion(db, "q1"), [a.id]);
});

test("fetchTagIdsForQuestions batches across multiple questions in one pass", async (t) => {
  const { sqlite, db } = baseFixture(t);
  insertQuestion(sqlite, "q1");
  insertQuestion(sqlite, "q2");
  const [a, b] = await resolveOrCreateTags(db, ["a", "b"], "2026-01-01T00:00:00.000Z");
  await db.batch(buildTagLinkStatements(db, "q1", [a.id], []));
  await db.batch(buildTagLinkStatements(db, "q2", [a.id, b.id], []));
  const map = await fetchTagIdsForQuestions(db, ["q1", "q2", "q-missing"]);
  assert.deepEqual([...map.get("q1")].sort(), [a.id]);
  assert.deepEqual([...map.get("q2")].sort(), [a.id, b.id].sort());
  assert.equal(map.has("q-missing"), false);
});

test("buildTagNameResolver resolves a whole batch's names in one bulk pass, tolerating unknown/invalid entries", async (t) => {
  const { db } = baseFixture(t);
  const resolveIds = await buildTagNameResolver(db, ["Alpha", "beta", "", null, undefined], "2026-01-01T00:00:00.000Z");
  const alpha = await findTagCatalogRowByName(db, "alpha");
  const beta = await findTagCatalogRowByName(db, "beta");
  assert.deepEqual([...resolveIds(["ALPHA", "beta"])].sort(), [alpha.id, beta.id].sort());
  assert.deepEqual(resolveIds(["not-registered-elsewhere"]), [], "a name never passed to the bulk resolve isn't silently created");
  assert.deepEqual(resolveIds(undefined), []);
});

test("countQuestionsForTag/countQuestionsForAnyTag and distinctExamIdsForTags reflect actual associations", async (t) => {
  const { sqlite, db } = baseFixture(t);
  sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)").run("examB", "exam-b", "Exam B", "2026-01-01T00:00:00.000Z");
  insertQuestion(sqlite, "q1", "examA");
  insertQuestion(sqlite, "q2", "examB");
  const [a, b] = await resolveOrCreateTags(db, ["a", "b"], "2026-01-01T00:00:00.000Z");
  await db.batch(buildTagLinkStatements(db, "q1", [a.id, b.id], []));
  await db.batch(buildTagLinkStatements(db, "q2", [a.id], []));

  assert.equal(await countQuestionsForTag(db, a.id), 2);
  assert.equal(await countQuestionsForTag(db, b.id), 1);
  assert.equal(await countQuestionsForAnyTag(db, [a.id, b.id]), 2, "q1 carries both — counted once");
  assert.deepEqual([...(await distinctExamIdsForTags(db, [a.id]))].sort(), ["examA", "examB"]);
  assert.deepEqual(await distinctExamIdsForTags(db, [b.id]), ["examA"]);
  assert.deepEqual(await distinctExamIdsForTags(db, []), []);
});

test("migration 0026 backfills a pre-existing tags_json column into question_bank_tags + question_tag_links, deduping by normalized name and preserving existing catalog ids", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const preRefactor = allMigrations.filter((n) => Number(n.slice(0, 4)) < 26);
  applyMigrations(sqlite, preRefactor);

  sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)").run("examA", "exam-a", "Exam A", "2026-01-01T00:00:00.000Z");
  const insertLegacyQuestion = sqlite.prepare(
    `INSERT INTO questions (id, exam_id, external_id, sequence_number, type, stem, options_json, correct_answers_json,
       explanation, difficulty, tags_json, points, created_at, updated_at)
     VALUES (?, 'examA', NULL, ?, 'fill_blank', ?, NULL, '["x"]', NULL, NULL, ?, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  );
  // "AWS" and "aws" on different questions must collapse to one catalog
  // identity; an existing lazily-registered implementation catalog row for "AWS" must
  // be the one preserved (its id must survive the backfill), and a
  // never-registered tag ("networking") must get a brand-new row.
  const preexistingId = "existing-aws-id";
  sqlite.prepare(
    "INSERT INTO question_bank_tags (id, name, created_at, updated_at) VALUES (?, 'AWS', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
  ).run(preexistingId);
  insertLegacyQuestion.run("q1", 1, "Q1", JSON.stringify(["AWS", "networking"]));
  insertLegacyQuestion.run("q2", 2, "Q2", JSON.stringify(["aws"]));
  insertLegacyQuestion.run("q3", 3, "Q3", JSON.stringify([]));
  // implementation review — a legacy tags_json entry with a leading '#' and/or
  // doubled internal whitespace must migrate to the SAME identity
  // normalizeTagName()+normalizeTagKey() would compute for it at runtime,
  // not a bare lower(trim(...)).
  insertLegacyQuestion.run("q4", 4, "Q4", JSON.stringify(["#Hash-Tag", "multi   word   tag", "#multi  word tag"]));
  // implementation follow-up review — a legacy value containing NBSP (U+00A0, JS
  // `\s`-whitespace but not ASCII whitespace) must migrate to the SAME
  // identity normalizeTagName()+normalizeTagKey() compute for it at
  // runtime. Both sides now treat NBSP as an ordinary character (neither
  // trims nor collapses it), so this only holds because normalizeTagName()
  // was narrowed to the migration's ASCII-only domain — before that fix,
  // this raw value would have collapsed to plain "aws cloud" in SQL while
  // the runtime kept the NBSP, landing on two different catalog rows.
  insertLegacyQuestion.run("q5", 5, "Q5", JSON.stringify(["aws cloud"]));

  applyMigrations(sqlite, allMigrations.filter((n) => Number(n.slice(0, 4)) >= 26));

  const awsRow = sqlite.prepare("SELECT id, name, normalized_name FROM question_bank_tags WHERE normalized_name = 'aws'").get();
  assert.equal(awsRow.id, preexistingId, "the pre-existing #65 catalog row's id survives the backfill");
  const networkingRow = sqlite.prepare("SELECT id FROM question_bank_tags WHERE normalized_name = 'networking'").get();
  assert.ok(networkingRow, "a never-registered tag gets backfilled a fresh catalog row");

  const q1Tags = sqlite.prepare(
    `SELECT t.name FROM question_tag_links l JOIN question_bank_tags t ON t.id = l.tag_id WHERE l.question_id = 'q1' ORDER BY t.name`,
  ).all().map((r) => r.name);
  assert.deepEqual(q1Tags, ["AWS", "networking"]);
  const q2Tags = sqlite.prepare(
    `SELECT t.id FROM question_tag_links l JOIN question_bank_tags t ON t.id = l.tag_id WHERE l.question_id = 'q2'`,
  ).all().map((r) => r.id);
  assert.deepEqual(q2Tags, [preexistingId], "q2's differently-cased 'aws' links to the SAME catalog identity as q1's 'AWS'");
  assert.deepEqual(sqlite.prepare("SELECT COUNT(*) c FROM question_tag_links WHERE question_id = 'q3'").get().c, 0);

  // "#Hash-Tag" and "#multi  word tag"/"multi   word   tag" must migrate to
  // exactly the identity lib/questionBankTags.ts's normalizeTagName()+
  // normalizeTagKey() compute for the same raw text at runtime — a leading
  // '#' and doubled whitespace are exactly the cases a bare
  // `lower(trim(x))` migration expression gets wrong (implementation review).
  for (const raw of ["#Hash-Tag", "multi   word   tag", "#multi  word tag"]) {
    const expectedKey = normalizeTagKey(normalizeTagName(raw));
    const row = sqlite.prepare(
      `SELECT t.normalized_name FROM question_tag_links l JOIN question_bank_tags t ON t.id = l.tag_id
       WHERE l.question_id = 'q4' AND t.normalized_name = ?`,
    ).get(expectedKey);
    assert.ok(row, `"${raw}" must link to the catalog identity ${JSON.stringify(expectedKey)}, matching the app's own normalization`);
  }
  // "multi   word   tag" and "#multi  word tag" both normalize to the same
  // identity ("multi word tag") — one catalog row, one link each, not two.
  assert.equal(
    normalizeTagKey(normalizeTagName("multi   word   tag")),
    normalizeTagKey(normalizeTagName("#multi  word tag")),
  );
  assert.equal(sqlite.prepare("SELECT COUNT(*) c FROM question_tag_links WHERE question_id = 'q4'").get().c, 2);
  // The display name never leaks the leading '#' or a doubled space.
  const hashTagRow = sqlite.prepare("SELECT name FROM question_bank_tags WHERE normalized_name = 'hash-tag'").get();
  assert.equal(hashTagRow.name, "Hash-Tag");
  const multiWordRow = sqlite.prepare("SELECT name FROM question_bank_tags WHERE normalized_name = 'multi word tag'").get();
  assert.equal(multiWordRow.name.includes("  "), false);
  assert.equal(multiWordRow.name.startsWith("#"), false);

  // implementation follow-up review — q5's tag carries a real NBSP (U+00A0) between
  // "aws" and "cloud". This only migrates to the SAME identity
  // normalizeTagName()+normalizeTagKey() compute at runtime because
  // normalizeTagName() was narrowed to the migration's ASCII-only
  // whitespace domain (neither side folds NBSP into a plain space).
  const nbspRaw = `aws${String.fromCharCode(0xa0)}cloud`;
  const nbspExpectedKey = normalizeTagKey(normalizeTagName(nbspRaw));
  const nbspRow = sqlite.prepare(
    `SELECT t.normalized_name FROM question_tag_links l JOIN question_bank_tags t ON t.id = l.tag_id
     WHERE l.question_id = 'q5' AND t.normalized_name = ?`,
  ).get(nbspExpectedKey);
  assert.ok(nbspRow, `NBSP-containing tag must link to the catalog identity ${JSON.stringify(nbspExpectedKey)}, matching the app's own normalization`);
  // And it must NOT have collapsed to the plain-space identity a
  // pre-implementation-fix migration (or a JS-\s-based runtime) would have produced.
  assert.notEqual(nbspExpectedKey, "aws cloud");

  // 0027 actually removed the legacy column.
  const columns = sqlite.prepare("PRAGMA table_info(questions)").all().map((c) => c.name);
  assert.ok(!columns.includes("tags_json"));
  assert.ok(columns.includes("import_baseline_tag_ids_json"));
});

test("migration 0026 resolves a collision between pre-existing catalog rows that only collide once normalization is corrected", async (t) => {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const preRefactor = allMigrations.filter((n) => Number(n.slice(0, 4)) < 26);
  applyMigrations(sqlite, preRefactor);
  sqlite.prepare("INSERT INTO exams (id, slug, name, created_at) VALUES (?, ?, ?, ?)").run("examA", "exam-a", "Exam A", "2026-01-01T00:00:00.000Z");

  // Simulates a pre-existing pair of catalog rows that a bare
  // `lower(trim(x))` migration would have left as two separate identities
  // (they only collide once the leading '#' is also stripped) — defends
  // against any historical row that predates normalizeTagName's current
  // shape, or was inserted out of band.
  sqlite.prepare(
    "INSERT INTO question_bank_tags (id, name, created_at, updated_at) VALUES ('id-a', '#AWS', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
  ).run();
  sqlite.prepare(
    "INSERT INTO question_bank_tags (id, name, created_at, updated_at) VALUES ('id-b', 'aws', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
  ).run();

  applyMigrations(sqlite, allMigrations.filter((n) => Number(n.slice(0, 4)) >= 26));

  const rows = sqlite.prepare("SELECT id, name FROM question_bank_tags WHERE normalized_name = 'aws'").all();
  assert.equal(rows.length, 1, "the unique index on normalized_name must hold — the collision was resolved, not left to fail CREATE UNIQUE INDEX");
  assert.equal(rows[0].id, "id-a", "lexicographically-first id survives as the single identity");
});
