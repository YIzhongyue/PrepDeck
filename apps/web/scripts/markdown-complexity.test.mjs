import test from "node:test";
import assert from "node:assert/strict";
import { importTs } from "../../../tests/support/bundle.mjs";

const { parseMarkdown, mdSegsFor } = await importTs([
  new URL("../src/lib/markdown.ts", import.meta.url),
  new URL("../src/lib/annotations.ts", import.meta.url),
], { platform: "node" });

test("unmatched labels search for their closing bracket only once", () => {
  const original = String.prototype.indexOf;
  for (const size of [8, 16, 32, 64]) {
    let searches = 0;
    String.prototype.indexOf = function (needle, from) {
      if (needle === "]") searches++;
      return original.call(this, needle, from);
    };
    try {
      const src = "[".repeat(size);
      assert.equal(parseMarkdown(src, true).plainText, src);
      assert.equal(searches, 1);
    } finally { String.prototype.indexOf = original; }
  }
});

test("links and excess URL parentheses preserve text and source offsets", () => {
  for (const src of ["[[label](https://e.test)", "[x](javascript:bad)", "https://e.test/a(b)))!", "https://e.test/" + ")".repeat(64)]) {
    const parsed = parseMarkdown(src, true);
    for (let i = 0; i < parsed.plainText.length; i++) assert.equal(parsed.plainText[i], src[parsed.sourceOffsets[i]]);
    if (src.startsWith("https")) assert.equal(parsed.inline[0].href, src.includes("a(b)") ? "https://e.test/a(b)" : "https://e.test/");
  }
  const splitLabel = parseMarkdown("[\nlabel](https://e.test)", true);
  assert.ok(!splitLabel.inline.some(range => range.kind === "link" && splitLabel.plainText.slice(range.start, range.end) === "label"));
});

test("disjoint inline ranges are indexed once across segments and blocks", () => {
  for (const multiline of [false, true]) {
    const reads = [];
    for (const size of [8, 16, 32, 64]) {
      const parsed = parseMarkdown(Array(size).fill("*a*").join(multiline ? "\n" : " "), true);
      let count = 0;
      parsed.inline = parsed.inline.map(range => new Proxy(range, { get(target, key) {
        if (key === "start" || key === "end") count++;
        return target[key];
      } }));
      // Include predicates over cloned local ranges: observing only the input
      // proxies would miss a quadratic scan performed after a shallow copy.
      const filter = Array.prototype.filter;
      let result;
      Array.prototype.filter = function (predicate, thisArg) {
        return filter.call(this, (value, index, array) => {
          count++;
          return predicate.call(thisArg, value, index, array);
        });
      };
      try { result = mdSegsFor(parsed, [], "q", "stem", false); }
      finally { Array.prototype.filter = filter; }
      const segs = result.flatMap(block => block.segs);
      assert.equal(segs.filter(seg => seg.italic).length, size);
      assert.equal(segs.map(seg => seg.text).join(""), parsed.plainText);
      reads.push(count);
    }
    for (let i = 1; i < reads.length; i++) assert.ok(reads[i] <= reads[i - 1] * 2.5, String(reads));
  }
});

test("overlap precedence and annotation endings survive indexed segmentation", () => {
  const parsed = parseMarkdown("[**abc**](https://e.test) next", true);
  const anns = [
    { id: "first", qid: "q", target: "stem", start: 3, end: 6, style: "underline", note: "first" },
    { id: "last", qid: "q", target: "stem", start: 4, end: 6, style: "bold", note: "last" },
  ];
  const segs = mdSegsFor(parsed, anns, "q", "stem", true).flatMap(block => block.segs);
  const overlap = segs.find(seg => seg.text === "bc");
  assert.equal(overlap.title, "last");
  assert.equal(overlap.deco, "underline");
  assert.equal(overlap.weight, "700");
  assert.equal(overlap.href, "https://e.test");
  assert.deepEqual(overlap.annotationIds, ["first", "last"]);
  assert.deepEqual(overlap.endingAnnotationIds, ["first", "last"]);
});
