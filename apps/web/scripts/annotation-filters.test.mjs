import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../../../tests/support/bundle.mjs";

const { annotationsQueryString, isDefaultView } = await importTs(new URL("../src/lib/annotationFilters.ts", import.meta.url), { target: "es2022" });

test("no filter, default sort produces an empty query string", () => {
  assert.equal(annotationsQueryString([], "asc"), "");
});

test("a single mark type is included as markType", () => {
  assert.equal(annotationsQueryString(["hl2"], "asc"), "markType=hl2");
});

test("multiple mark types are comma-joined", () => {
  assert.equal(annotationsQueryString(["hl1", "hl3"], "asc"), "markType=hl1%2Chl3");
});

test("sort=desc is included in the query string", () => {
  assert.equal(annotationsQueryString([], "desc"), "sort=desc");
});

test("sort=asc (the server default) is omitted", () => {
  assert.equal(annotationsQueryString(["hl1"], "asc"), "markType=hl1");
});

test("a filter and a non-default sort combine", () => {
  assert.equal(annotationsQueryString(["hl1", "hl2"], "desc"), "markType=hl1%2Chl2&sort=desc");
});

test("isDefaultView is true only with no filter and ascending sort", () => {
  assert.equal(isDefaultView([], "asc"), true);
  assert.equal(isDefaultView([], "desc"), false);
  assert.equal(isDefaultView(["hl1"], "asc"), false);
  assert.equal(isDefaultView(["hl1"], "desc"), false);
});
