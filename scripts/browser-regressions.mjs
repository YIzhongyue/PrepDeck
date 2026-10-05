// Runs the *.browser.mjs regressions one after another and reports every
// failure, not only the first (issue #83). `npm run test:browser` used to be
// one `&&` chain: the first failing script hid every script after it, and the
// log named one failure. Here each script runs in its own process with a
// timeout, its output prefixed with its name, and a failing script keeps the
// screenshots, DOM and console/request log scripts/browser-diagnostics.mjs
// saved for it. There is deliberately no retry: a script that fails, fails.
//
//   node scripts/browser-regressions.mjs                 every script
//   node scripts/browser-regressions.mjs settings turnstile
//   node scripts/browser-regressions.mjs --shard 2/3     CI's matrix
//   node scripts/browser-regressions.mjs --list [--shard 2/3]
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));

// Each script with roughly how long it takes, in seconds, which is all the
// shards are balanced on. question-classifications and question-prose are
// not listed because question-authoring and component-annotations import,
// and so run, them.
export const SCRIPTS = [
  ["apps/web/scripts/exam-workspace.browser.mjs", 35],
  ["apps/web/scripts/url-routing.browser.mjs", 5],
  ["apps/web/scripts/knowledge-points.browser.mjs", 85],
  ["apps/web/scripts/question-authoring.browser.mjs", 12],
  ["apps/web/scripts/mcp-setup.browser.mjs", 4],
  ["apps/web/scripts/mcp-connect.browser.mjs", 3],
  ["apps/web/scripts/turnstile.browser.mjs", 5],
  ["apps/web/scripts/answer-state.browser.mjs", 9],
  ["apps/web/scripts/question-card-layout.browser.mjs", 14],
  ["apps/web/scripts/review-lists.browser.mjs", 5],
  ["apps/web/scripts/under-review.browser.mjs", 5],
  ["apps/web/scripts/study-status.browser.mjs", 5],
  ["apps/web/scripts/settings.browser.mjs", 10],
  ["apps/web/scripts/statistics.browser.mjs", 18],
  ["apps/web/scripts/admin-console.browser.mjs", 6],
  ["apps/web/scripts/mascot-settings.browser.mjs", 8],
  ["apps/web/scripts/component-annotations.browser.mjs", 3],
  ["apps/web/scripts/question-content.browser.mjs", 6],
  ["apps/web/scripts/mcp-presentation.browser.mjs", 1],
  ["tests/pdf-to-quiz/review.browser.mjs", 1],
];

export const nameOf = script => basename(script, ".browser.mjs");

// Heaviest first onto the lightest shard, so the same list always splits the
// same way and no shard waits on two of the slow scripts.
export function shardOf(scripts, index, total) {
  const loads = Array.from({ length: total }, () => ({ seconds: 0, scripts: [] }));
  for (const [script, seconds] of [...scripts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const lightest = loads.reduce((min, load) => load.seconds < min.seconds ? load : min);
    lightest.seconds += seconds;
    lightest.scripts.push(script);
  }
  const chosen = new Set(loads[index - 1].scripts);
  return scripts.map(([script]) => script).filter(script => chosen.has(script));
}

function select({ names, shard }) {
  let scripts = SCRIPTS.map(([script]) => script);
  if (shard) {
    const match = /^(\d+)\/(\d+)$/.exec(shard);
    const [index, total] = match ? [Number(match[1]), Number(match[2])] : [];
    if (!match || index < 1 || index > total) throw new Error(`--shard takes N/TOTAL, such as 2/3, not ${shard}`);
    scripts = shardOf(SCRIPTS, index, total);
  }
  if (names.length) {
    const unknown = names.filter(name => !SCRIPTS.some(([script]) => nameOf(script) === name));
    if (unknown.length) throw new Error(`No browser regression named ${unknown.join(", ")}. Known: ${SCRIPTS.map(([s]) => nameOf(s)).join(", ")}`);
    scripts = scripts.filter(script => names.includes(nameOf(script)));
  }
  return scripts;
}

// A script that runs out of time is asked over IPC to save its pages and
// exit (see scripts/browser-diagnostics.mjs), and killed if it has not
// within `grace`: a signal would either skip the capture (Windows) or race
// Playwright's own handler closing Chromium under it (everywhere else).
export function run(script, { diagnostics, timeout, grace = 30_000, log = console.log }) {
  const name = nameOf(script);
  const started = Date.now();
  const tail = [];
  return new Promise(done => {
    const child = spawn(process.execPath, ["--import", pathToFileURL(join(root, "scripts/browser-diagnostics.mjs")).href, resolve(root, script)], {
      cwd: root, env: { ...process.env, BROWSER_DIAGNOSTICS_DIR: diagnostics }, stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let timedOut = false, killer;
    const timer = setTimeout(() => {
      timedOut = true;
      log(`[${name}] still running after ${timeout / 1000} s; saving its pages and stopping it`);
      killer = setTimeout(() => child.kill("SIGKILL"), grace);
      try { child.send({ type: "capture-and-exit" }); } catch { child.kill("SIGKILL"); }
    }, timeout);
    for (const stream of [child.stdout, child.stderr]) {
      let partial = "";
      stream.setEncoding("utf8");
      stream.on("data", text => {
        const lines = (partial + text).split(/\r?\n/);
        partial = lines.pop();
        for (const line of lines) emit(line);
      });
      stream.on("end", () => { if (partial) emit(partial); });
    }
    function emit(line) {
      log(`[${name}] ${line}`);
      tail.push(line);
      if (tail.length > 40) tail.shift();
    }
    child.on("error", error => emit(`could not start: ${error.message}`));
    child.on("close", (code, signal) => {
      clearTimeout(timer); clearTimeout(killer);
      done({ script, name, seconds: (Date.now() - started) / 1000, passed: code === 0 && !timedOut, code, signal, timedOut, tail });
    });
  });
}

// GitHub renders these as annotations on the run and on the PR's diff.
const escapeData = text => text.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const escapeProperty = text => escapeData(text).replace(/:/g, "%3A").replace(/,/g, "%2C");

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { shard: { type: "string" }, list: { type: "boolean" } } });
  const scripts = select({ names: positionals, shard: values.shard });
  if (values.list) { for (const script of scripts) console.log(script); return; }
  if (!scripts.length) throw new Error("No browser regressions selected.");

  const artifacts = resolve(process.env.BROWSER_DIAGNOSTICS_ROOT ?? join(tmpdir(), "prepdeck-browser-diagnostics"));
  const timeout = Number(process.env.BROWSER_SCRIPT_TIMEOUT_MS ?? 300_000);
  for (const dir of ["SCREENSHOT_DIR", "KP_SCREENSHOTS"]) if (process.env[dir]) mkdirSync(process.env[dir], { recursive: true });
  const label = values.shard ? ` (shard ${values.shard})` : "";
  console.log(`Running ${scripts.length} browser regressions${label}: ${scripts.map(nameOf).join(", ")}`);

  const results = [];
  for (const [i, script] of scripts.entries()) {
    const name = nameOf(script);
    const diagnostics = join(artifacts, name);
    rmSync(diagnostics, { recursive: true, force: true });
    console.log(`\n▶ START ${name} (${i + 1}/${scripts.length}) ${script}`);
    const result = await run(script, { diagnostics, timeout });
    const how = result.timedOut ? `timed out after ${timeout / 1000} s` : result.signal ? `killed by ${result.signal}` : `exit ${result.code}`;
    if (result.passed) {
      rmSync(diagnostics, { recursive: true, force: true });
      console.log(`✔ PASS ${name} in ${result.seconds.toFixed(1)} s`);
    } else {
      const saved = existsSync(diagnostics) ? readdirSync(diagnostics).length : 0;
      result.diagnostics = saved ? diagnostics : null;
      console.log(`✖ FAIL ${name} in ${result.seconds.toFixed(1)} s (${how})${saved ? `; ${saved} diagnostic files in ${diagnostics}` : ""}`);
    }
    result.how = how;
    results.push(result);
  }

  const failed = results.filter(result => !result.passed);
  console.log(`\n${results.length - failed.length}/${results.length} browser regressions passed${label}.`);
  for (const result of results) console.log(`  ${result.passed ? "PASS" : "FAIL"}  ${result.name.padEnd(24)} ${result.seconds.toFixed(1).padStart(6)} s${result.passed ? "" : `  ${result.how}`}`);

  if (process.env.GITHUB_ACTIONS) {
    for (const result of failed) {
      const message = `${result.name} failed (${result.how}). Last output:\n${result.tail.slice(-15).join("\n")}`;
      console.log(`::error file=${escapeProperty(result.script)},title=${escapeProperty(`Browser regression failed: ${result.name}`)}::${escapeData(message)}`);
    }
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map(result => `| ${result.passed ? "✅" : "❌"} | \`${result.name}\` | ${result.seconds.toFixed(1)} s | ${result.passed ? "" : result.how} |`);
    const details = failed.map(result => `\n<details><summary>${result.name}: last output</summary>\n\n\`\`\`\n${result.tail.join("\n")}\n\`\`\`\n</details>`);
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [`### Browser regressions${label}`, "", "| | Script | Time | Failure |", "| --- | --- | --- | --- |", ...rows, ...details, ""].join("\n") + "\n");
  }
  if (failed.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
