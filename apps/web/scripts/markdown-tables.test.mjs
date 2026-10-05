import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL("../src/lib/markdown.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { parseMarkdown } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

const fixture = "| Option | Why it is incorrect |\n| --- | --- |\n| A | **SHA256** is a one-way hash. |\n| B | Administrators cannot view secrets in plain text. |";
const cellsOf = (parsed) => parsed.blocks.filter(b => b.cell).map(b => ({ ...b.cell, text: parsed.plainText.slice(b.start, b.end) }));

test("a GFM table becomes header and data cells without the delimiter row", () => {
  const parsed = parseMarkdown(fixture, false, false, true);
  const cells = cellsOf(parsed);
  assert.equal(parsed.blocks.length, 6);
  assert.deepEqual(cells.map(c => [c.row, c.col, c.header, c.text]), [
    [0, 0, true, "Option"], [0, 1, true, "Why it is incorrect"],
    [1, 0, false, "A"], [1, 1, false, "SHA256 is a one-way hash."],
    [2, 0, false, "B"], [2, 1, false, "Administrators cannot view secrets in plain text."]
  ]);
  assert.ok(!parsed.plainText.includes("---"));
  const bold = parsed.inline.find(r => r.kind === "bold");
  assert.equal(parsed.plainText.slice(bold.start, bold.end), "SHA256");
});

test("tables are opt-in so existing parses are unchanged", () => {
  assert.deepEqual(parseMarkdown(fixture).blocks.map(b => b.type), ["p", "p", "p", "p"]);
});

test("alignment, escaped pipes, short rows and empty cells", () => {
  const src = "a | b | c\n:--- | :-: | ---:\n`x` \\| y | [l](https://e.test) |\n";
  const parsed = parseMarkdown(src, false, false, true);
  const cells = cellsOf(parsed);
  assert.deepEqual(cells.filter(c => c.row === 0).map(c => c.align), ["left", "center", "right"]);
  assert.deepEqual(cells.filter(c => c.row === 1).map(c => c.text), ["x | y", "l", ""]);
  assert.ok(parsed.inline.some(r => r.kind === "link" && r.href === "https://e.test"));
  assert.ok(parsed.inline.some(r => r.kind === "code"));
});

test("source offsets address the original characters and the table ends at a blank line", () => {
  const src = "| H |\n| - |\n| val |\n\nafter";
  const parsed = parseMarkdown(src, true, false, true);
  const val = parsed.blocks.find(b => parsed.plainText.slice(b.start, b.end) === "val");
  assert.equal(src[parsed.sourceOffsets[val.start]], "v");
  assert.deepEqual(parsed.blocks.map(b => b.type), ["cell", "cell", "p"]);
});

test("a pipe line without a delimiter row stays a paragraph", () => {
  assert.deepEqual(parseMarkdown("a | b\nnot a delimiter", false, false, true).blocks.map(b => b.type), ["p", "p"]);
});
