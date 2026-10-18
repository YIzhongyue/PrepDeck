// The D1 schema for Node tests: the repository's own migrations, applied in
// order to a node:sqlite database.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export const MIGRATIONS_DIRECTORY = new URL("../../migrations/", import.meta.url);

// Question-bank content rather than schema. The public export replaces it
// with a no-op (docs/guides/public-private-sync.md), so a test that needs
// questions inserts its own.
export const SEED_MIGRATION = "0002_seed_sap_c02_questions.sql";

/** Every migration file name, in the order D1 applies them. */
export function migrationNames() {
  return readdirSync(MIGRATIONS_DIRECTORY).filter(name => name.endsWith(".sql")).sort();
}

/**
 * The SQL of the chosen migrations, in order.
 *
 * @param {{ only?: string[], filter?: (name: string) => boolean }} [options]
 *   `only` names the migrations to apply, in the order given; `filter` keeps
 *   the migrations it accepts. Without either, every migration is applied.
 */
export function migrationSql({ only, filter = () => true } = {}) {
  const names = only ?? migrationNames().filter(filter);
  return names.map(name => readFileSync(new URL(name, MIGRATIONS_DIRECTORY), "utf8")).join("\n");
}

export function applyMigrations(sqlite, options) {
  sqlite.exec(migrationSql(options));
}

/**
 * A migrated in-memory database. Given a test context, it is closed when that
 * test ends.
 *
 * @param {import("node:test").TestContext | null} [t]
 * @param {{ only?: string[], filter?: (name: string) => boolean } | false} [migrations]
 *   Which migrations to apply (see migrationSql), or false for none.
 */
export function openDatabase(t, migrations = {}) {
  const sqlite = new DatabaseSync(":memory:");
  t?.after(() => sqlite.close());
  if (migrations) applyMigrations(sqlite, migrations);
  return sqlite;
}
