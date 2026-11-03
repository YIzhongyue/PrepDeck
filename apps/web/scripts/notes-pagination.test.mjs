import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";

// Action-level tests: React callbacks/refs are stand-ins, not lifecycle proof.
const { useQuestionNotes } = await importTs(new URL("../src/store/actions/useQuestionNotes.ts", import.meta.url), {
  plugins: [{ name: "synthetic-notes-actions", setup(build) {
    build.onResolve({ filter: /^(react|.*\/lib\/api|.*\/i18n\/runtime)$/ }, args => ({ path: args.path, namespace: "test" }));
    build.onLoad({ filter: /.*/, namespace: "test" }, args => ({ contents: args.path === "react"
      ? "export const useCallback = fn => fn; export const useRef = value => ({current:value});"
      : args.path.endsWith("/api") ? "export const apiFetch = (...args) => globalThis.notesFetch(...args);"
      : "export const t = key => key;" }));
  } }],
});
const { WorkspaceRequests } = await importTs(new URL("../src/lib/examWorkspace.ts", import.meta.url));
const tick = () => new Promise(resolve => setImmediate(resolve));
const note = id => ({ id, createdAt: "2026-01-01", questionId: "q", content: "synthetic", visibility: "shared", isMine: false, author: { id: "a", displayName: "Test", avatarUrl: null } });
function setup() {
  const stateRef = { current: { examId: "exam", notes: [], notesPages: {}, showShared: true } };
  const setState = patch => { stateRef.current = { ...stateRef.current, ...(typeof patch === "function" ? patch(stateRef.current) : patch) }; };
  const requests = new WorkspaceRequests();
  const scopedState = lane => { const valid = requests.capture(lane); return patch => { if (valid()) setState(patch); }; };
  return { stateRef, requests, actions: useQuestionNotes({ stateRef, requests, scopedState, setState }) };
}

test("one action requests one page, deduplicates overlap, retries failure without losing position", async () => {
  const f = setup(), calls = [];
  let fail = false;
  globalThis.notesFetch = async path => { calls.push(path); if (fail) throw Error("offline"); return { notes: [note("one")], nextCursor: calls.length === 1 ? "next" : null }; };
  f.actions.loadNotesPage(); f.actions.loadNotesPage();
  await tick();
  assert.equal(calls.length, 1);
  assert.equal(f.stateRef.current.notesPages.exam.cursor, "next");
  fail = true; f.actions.loadNotesPage(); await tick();
  assert.equal(f.stateRef.current.notesPages.exam.status, "error");
  fail = false; f.actions.loadNotesPage(); await tick();
  assert.match(calls[2], /cursor=next/);
  assert.equal(f.stateRef.current.notes.length, 1);
  f.actions.loadNotesPage(); await tick();
  assert.equal(calls.length, 3);
});

test("workspace invalidation and visibility changes discard stale pages", async () => {
  const f = setup();
  let resolve;
  globalThis.notesFetch = () => new Promise(done => { resolve = done; });
  f.actions.loadNotesPage("q");
  f.requests.invalidate(); resolve({ notes: [note("stale")], nextCursor: null }); await tick();
  assert.equal(f.stateRef.current.notes.length, 0);
  const g = setup(); let resolvePage;
  globalThis.notesFetch = (path) => path === "/api/settings" ? Promise.resolve({}) : new Promise(done => { resolvePage = done; });
  g.actions.loadNotesPage(); g.actions.toggleShared(); await tick();
  resolvePage({ notes: [note("hidden")], nextCursor: null }); await tick();
  assert.equal(g.stateRef.current.showShared, false);
  assert.deepEqual(g.stateRef.current.notes, []);
  assert.deepEqual(g.stateRef.current.notesPages, {});
});

test("interleaved exam and question pages keep server creation/id ordering", async () => {
  const f = setup();
  globalThis.notesFetch = async path => path.includes("questions/")
    ? { notes: [note("z"), { ...note("a"), createdAt: "2026-01-02" }], nextCursor: null }
    : { notes: [note("b"), note("z")], nextCursor: null };
  f.actions.loadNotesPage("q"); await tick();
  f.actions.loadNotesPage(); await tick();
  assert.deepEqual(f.stateRef.current.notes.map(n => n.id), ["b", "z", "a"]);
});
