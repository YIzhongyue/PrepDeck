// A D1Database for Node tests, backed by a node:sqlite database. It follows
// the parts of D1's contract that the Worker relies on:
// - bind() returns a new statement, and an unbound statement runs directly;
// - first() resolves to null when there is no row;
// - batch() is one transaction: every statement applies, or none does;
// - a statement binds at most 100 parameters, as D1 enforces.

// D1's limit on bound parameters per statement
// (https://developers.cloudflare.com/d1/platform/limits/).
export const D1_MAX_BOUND_PARAMETERS = 100;

const READ_ONLY = /^\s*(SELECT|WITH|PRAGMA|EXPLAIN|VALUES)\b/i;

/**
 * @typedef {{ sql: string, args: unknown[], method: "first" | "all" | "raw" | "run" | "batch" }} D1Query
 * @typedef {{
 *   onQuery?: (query: D1Query) => void | Promise<void>,
 *   afterQuery?: (query: D1Query & { result: unknown }) => void | Promise<void>,
 *   afterBatch?: (statements: D1Query[]) => void | Promise<void>,
 *   maxBoundParameters?: number,
 * }} D1Options
 */

/**
 * @param {import("node:sqlite").DatabaseSync} sqlite
 * @param {D1Options} [options]
 *   `onQuery` runs before each statement executes, batched statements
 *   included, and may throw to simulate a failure or await to hold a request
 *   at that point. `afterQuery` runs once a single statement has executed and
 *   before its caller sees the result, so a test can change the database
 *   between a read and what the code does with it. `afterBatch` runs once a
 *   batch has committed.
 */
export function createD1(sqlite, { onQuery, afterQuery, afterBatch, maxBoundParameters = D1_MAX_BOUND_PARAMETERS } = {}) {
  function execute(sql, args) {
    const statement = sqlite.prepare(sql);
    if (statement.columns().length === 0) {
      const { changes, lastInsertRowid } = statement.run(...args);
      return { success: true, results: [], meta: { changes: Number(changes), last_row_id: Number(lastInsertRowid) } };
    }
    const results = statement.all(...args);
    const changes = READ_ONLY.test(sql) ? 0 : Number(sqlite.prepare("SELECT changes() AS n").get().n);
    return { success: true, results, meta: { changes, last_row_id: 0 } };
  }

  async function before(sql, args, method) {
    if (args.length > maxBoundParameters) {
      throw new Error(`D1 binds at most ${maxBoundParameters} parameters per statement; this one has ${args.length}: ${sql}`);
    }
    await onQuery?.({ sql, args, method });
  }

  async function query(sql, args, method, read) {
    await before(sql, args, method);
    const result = read();
    await afterQuery?.({ sql, args, method, result });
    return result;
  }

  function statement(sql, args) {
    return {
      sql,
      args,
      bind: (...values) => statement(sql, values),
      async first(column) {
        const row = await query(sql, args, "first", () => sqlite.prepare(sql).get(...args) ?? null);
        if (column === undefined || row === null) return row;
        if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: ${column}`);
        return row[column];
      },
      all: () => query(sql, args, "all", () => ({ success: true, results: sqlite.prepare(sql).all(...args), meta: { changes: 0 } })),
      raw: () => query(sql, args, "raw", () => sqlite.prepare(sql).all(...args).map(row => Object.values(row))),
      run: () => query(sql, args, "run", () => execute(sql, args)),
    };
  }

  return {
    prepare: sql => statement(sql, []),
    async batch(statements) {
      for (const { sql, args } of statements) await before(sql, args, "batch");
      // Nothing is awaited between BEGIN and COMMIT, so no other request's
      // statements can land inside this batch's transaction.
      sqlite.exec("BEGIN");
      let results;
      try {
        results = statements.map(({ sql, args }) => execute(sql, args));
        sqlite.exec("COMMIT");
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
      await afterBatch?.(statements.map(({ sql, args }) => ({ sql, args, method: "batch" })));
      return results;
    },
    async exec(sql) {
      sqlite.exec(sql);
      return { count: 0, duration: 0 };
    },
  };
}
