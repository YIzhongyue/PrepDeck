import assert from "node:assert/strict";
import test from "node:test";

import { shouldMigrateRemote } from "./migrate-remote-if-ci.mjs";

test("migrates on the production branch in Workers Builds", () => {
  assert.equal(
    shouldMigrateRemote({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "master" }),
    true
  );
});

test("does not migrate for a Workers preview build", () => {
  assert.equal(
    shouldMigrateRemote({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "codex/light" }),
    false
  );
});

test("does not mistake a generic CI environment for Workers Builds", () => {
  assert.equal(shouldMigrateRemote({ CI: "true" }), false);
});

test("supports an explicitly configured production branch", () => {
  assert.equal(
    shouldMigrateRemote({
      WORKERS_CI: "1",
      WORKERS_CI_BRANCH: "main",
      CLOUDFLARE_PRODUCTION_BRANCH: "main"
    }),
    true
  );
});
