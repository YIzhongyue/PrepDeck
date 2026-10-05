// Issue #119: the client's studied statuses. A fetch that left the server
// before a local change must not revert it, and the three-way filter combines
// with nothing but the status itself.
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL("../src/lib/studyStatus.ts", import.meta.url))],
  bundle: true, write: false, platform: "neutral", format: "esm", mainFields: ["module", "main"],
});
const { mergeStudyStatuses, matchesStudyStatus, studyFilterCounts, isQuestionStudied } =
  await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const entry = (questionId, status, revision) => ({ questionId, status, revision, updatedAt: "2026-10-05T00:00:00Z" });

test("a question with no entry is unstudied, and only 'studied' counts as studied", () => {
  const statuses = { A: entry("A", "studied", 1), B: entry("B", "unstudied", 2) };
  assert.equal(isQuestionStudied(statuses, "A"), true);
  assert.equal(isQuestionStudied(statuses, "B"), false);
  assert.equal(isQuestionStudied(statuses, "C"), false);
});

test("each filter keeps exactly its own questions, and counts agree with it", () => {
  const statuses = { A: entry("A", "studied", 1), B: entry("B", "unstudied", 2) };
  const questions = [{ id: "A" }, { id: "B" }, { id: "C" }];
  const keep = filter => questions.filter(q => matchesStudyStatus(filter, statuses, q.id)).map(q => q.id);
  assert.deepEqual(keep("all"), ["A", "B", "C"]);
  assert.deepEqual(keep("studied"), ["A"]);
  assert.deepEqual(keep("unstudied"), ["B", "C"]);
  assert.deepEqual(studyFilterCounts(questions, statuses), { all: 3, studied: 1, unstudied: 2 });
});

test("a refresh keeps the newer entry per question, so an old response cannot undo a reset", () => {
  const local = { A: entry("A", "unstudied", 3), B: entry("B", "studied", 1) };
  const merged = mergeStudyStatuses(local, [entry("A", "studied", 2), entry("B", "unstudied", 4), entry("C", "studied", 1)]);
  assert.equal(merged.A.status, "unstudied", "revision 2 is older than the local reset");
  assert.equal(merged.B.status, "unstudied", "revision 4 is newer");
  assert.equal(merged.C.status, "studied");
});

test("an optimistic local entry wins a tie, and a pending write keeps its local entry outright", () => {
  // The optimistic value keeps the revision it replaced until the server answers.
  const local = { A: entry("A", "unstudied", 1), B: entry("B", "studied", 1) };
  const merged = mergeStudyStatuses(local, [entry("A", "studied", 1), entry("B", "unstudied", 5)], new Set(["B"]));
  assert.equal(merged.A.status, "unstudied");
  assert.equal(merged.B.status, "studied");
});
