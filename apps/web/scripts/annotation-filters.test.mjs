import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transformSync } from "esbuild";

const source = readFileSync(new URL("../src/lib/annotationFilters.ts", import.meta.url), "utf8");
const { code } = transformSync(source, {
  loader: "ts", format: "esm", target: "es2022"
});
const { annotationsQueryString, isDefaultView } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);

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
