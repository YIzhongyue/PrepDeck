// Runs pending D1 migrations against the *remote production* database, but
// only for the production branch in Cloudflare Workers Builds — never for a
// preview branch, GitHub Actions, or a plain local `npm run build`. This closes
// the gap that caused
// Section 3.7's AI-explanation bug: the deployed Worker code expected
// columns (migration 0008) that were never applied to the remote database,
// because nothing in the deploy pipeline ran `db:migrate:remote` for us.
//
// Workers Builds injects WORKERS_CI=1 and WORKERS_CI_BRANCH into every build
// (https://developers.cloudflare.com/workers/ci-cd/builds/build-image/) —
// Checking both values means preview builds stay read-only and a developer's
// local build remains network/credential-independent, while the production
// deploy pipeline (which runs `npm run build` immediately before
// `wrangler deploy`, per its fixed two-step build/deploy command sequence)
// always keeps the remote schema in sync with the code being deployed.

import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function shouldMigrateRemote(env = process.env) {
  const productionBranch = env.CLOUDFLARE_PRODUCTION_BRANCH || "master";
  return env.WORKERS_CI === "1" && env.WORKERS_CI_BRANCH === productionBranch;
}

export function migrateRemote(env = process.env) {
  if (!shouldMigrateRemote(env)) {
    console.log(
      "[migrate-remote-if-ci] Skipping remote D1 migration " +
        `(build branch: ${env.WORKERS_CI_BRANCH || "not a Workers Build"}).`
    );
    return;
  }

  console.log(
    "[migrate-remote-if-ci] Production Workers Build — applying pending remote D1 migrations..."
  );
  execSync("npx wrangler d1 migrations apply prepdeck --remote", { stdio: "inherit" });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  migrateRemote();
}
