import assert from "node:assert/strict";
import test from "node:test";
import { computeMidpointPosition, rebalancePositions, scopeKeyFor, POSITION_GAP, UNGROUPED_SCOPE_KEY } from "./knowledgePointOrdering.ts";

test("empty scope: first note ever gets the base gap", () => {
  assert.equal(computeMidpointPosition(null, null), POSITION_GAP);
});

test("insert at the start: below the current first position", () => {
  const pos = computeMidpointPosition(null, 500);
  assert.equal(pos, 500 - POSITION_GAP);
  assert.ok(pos! < 500);
});

test("insert at the end: above the current last position", () => {
  assert.equal(computeMidpointPosition(1024, null), 1024 + POSITION_GAP);
});

test("insert between two neighbors: exact midpoint", () => {
  assert.equal(computeMidpointPosition(1024, 2048), 1536);
});

test("midpoint is strictly between neighbors for a typical gap", () => {
  const pos = computeMidpointPosition(1024, 1025)!;
  assert.ok(pos > 1024 && pos < 1025);
});

test("float exhaustion between two adjacent-precision neighbors returns null", () => {
  const prev = 1;
  const next = prev + Number.EPSILON;
  assert.equal(computeMidpointPosition(prev, next), null);
});

test("rebalance spaces an ordered list evenly starting at one gap", () => {
  const result = rebalancePositions([{ id: "a" }, { id: "b" }, { id: "c" }]);
  assert.deepEqual(
    result.map((r) => r.position),
    [POSITION_GAP, POSITION_GAP * 2, POSITION_GAP * 3]
  );
});

test("rebalance preserves relative order and ids", () => {
  const result = rebalancePositions([{ id: "z" }, { id: "a" }, { id: "m" }]);
  assert.deepEqual(result.map((r) => r.id), ["z", "a", "m"]);
});

test("rebalance of an empty list returns an empty list", () => {
  assert.deepEqual(rebalancePositions([]), []);
});

test("scopeKeyFor maps a real group id to itself and null to the Ungrouped sentinel", () => {
  assert.equal(scopeKeyFor("g1"), "g1");
  assert.equal(scopeKeyFor(null), UNGROUPED_SCOPE_KEY);
});
