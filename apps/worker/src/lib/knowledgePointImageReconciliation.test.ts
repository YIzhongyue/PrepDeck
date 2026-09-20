import assert from "node:assert/strict";
import test from "node:test";
import { reconcileImageStatuses } from "./knowledgePointImageReconciliation.ts";

test("a referenced pending image is attached", () => {
  const result = reconcileImageStatuses("See ![](/api/kp-images/img1) above.", [{ id: "img1", status: "pending" }]);
  assert.deepEqual(result, { toAttach: ["img1"], toOrphan: [] });
});

test("an unreferenced pending image is left alone (not yet abandoned, not attached)", () => {
  const result = reconcileImageStatuses("No images here.", [{ id: "img1", status: "pending" }]);
  assert.deepEqual(result, { toAttach: [], toOrphan: [] });
});

test("a previously-attached image whose reference was removed becomes orphaned", () => {
  const result = reconcileImageStatuses("Text with no image reference now.", [{ id: "img1", status: "attached" }]);
  assert.deepEqual(result, { toAttach: [], toOrphan: ["img1"] });
});

test("a still-referenced attached image needs no write", () => {
  const result = reconcileImageStatuses("![](/api/kp-images/img1)", [{ id: "img1", status: "attached" }]);
  assert.deepEqual(result, { toAttach: [], toOrphan: [] });
});

test("an orphaned image referenced again is re-attached", () => {
  const result = reconcileImageStatuses("Back in the text: ![](/api/kp-images/img1)", [{ id: "img1", status: "orphaned" }]);
  assert.deepEqual(result, { toAttach: ["img1"], toOrphan: [] });
});

test("a still-unreferenced orphaned image needs no write", () => {
  const result = reconcileImageStatuses("Nothing relevant.", [{ id: "img1", status: "orphaned" }]);
  assert.deepEqual(result, { toAttach: [], toOrphan: [] });
});

test("handles a mix of images independently", () => {
  const body = "![](/api/kp-images/keep) and ![](/api/kp-images/new)";
  const result = reconcileImageStatuses(body, [
    { id: "keep", status: "attached" },
    { id: "new", status: "pending" },
    { id: "removed", status: "attached" },
    { id: "stale", status: "orphaned" },
  ]);
  assert.deepEqual(result.toAttach.sort(), ["new"]);
  assert.deepEqual(result.toOrphan.sort(), ["removed"]);
});

test("no known images yields empty results regardless of body content", () => {
  assert.deepEqual(reconcileImageStatuses("![](/api/kp-images/img1)", []), { toAttach: [], toOrphan: [] });
});
