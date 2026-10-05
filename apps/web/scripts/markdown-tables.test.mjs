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

test("list items, headings and rules after a table end it and keep their full text", () => {
  for (const next of ["- Use a | b | c to compare.", "1. Use a | b | c to compare.", "## Use a | b | c", "---"]) {
    const parsed = parseMarkdown(`| A | B |\n| --- | --- |\n| one | two |\n${next}`, false, false, true);
    assert.equal(parsed.blocks.filter(b => b.cell).length, 4, next);
    const last = parsed.blocks.at(-1);
    assert.ok(!last.cell, next);
    if (next !== "---") assert.ok(parsed.plainText.endsWith("a | b | c to compare.") || parsed.plainText.endsWith("a | b | c"), next);
  }
});

test("a code fence ends the table and the following line is a whole paragraph", () => {
  const parsed = parseMarkdown("| A | B |\n| --- | --- |\n| one | two |\n```\nx | y\n```\nAfter | code | lost", false, false, true);
  assert.deepEqual(parsed.blocks.map(b => b.type), ["cell", "cell", "cell", "cell", "code", "p"]);
  assert.equal(parsed.plainText.slice(parsed.blocks.at(-1).start), "After | code | lost");
});

test("a short row without pipes is padded", () => {
  const cells = cellsOf(parseMarkdown("| a | b |\n| - | - |\n| x | y |\nbar", false, false, true));
  assert.deepEqual(cells.filter(c => c.row === 2).map(c => c.text), ["bar", ""]);
});

async function renderer() {
  const { outputFiles } = await build({
    stdin: {
      contents: `import { createElement } from "react"; import { renderToStaticMarkup } from "react-dom/server"; import M from "./src/components/MarkdownHighlightedText.tsx"; export const render = (src) => renderToStaticMarkup(createElement(M, { src, annotations: [], qid: "q", target: "stem", show: false, tables: true }));`,
      resolveDir: fileURLToPath(new URL("..", import.meta.url)), loader: "tsx"
    },
    bundle: true, write: false, platform: "node", format: "esm", jsx: "automatic",
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' }
  });
  const dir = fileURLToPath(new URL("../node_modules/.cache/", import.meta.url));
  const { mkdirSync, writeFileSync } = await import("node:fs");
  mkdirSync(dir, { recursive: true });
  const file = `${dir}markdown-render.test.mjs`;
  writeFileSync(file, outputFiles[0].text);
  return import(file);
}

test("the renderer outputs semantic cells and complete text across block boundaries", async () => {
  const { render } = await renderer();
  const html = render("| Option | Why |\n| :-- | --: |\n| A | **SHA256** is `x` |\n- Use a | b | c\n```\nx | y\n```\nAfter | code | lost");
  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.equal((html.match(/<th /g) ?? []).length, 2);
  assert.equal((html.match(/<td /g) ?? []).length, 2);
  assert.ok(html.includes("text-align:right"));
  assert.ok(!html.includes("---") && !html.includes(":--"));
  assert.ok(html.includes("<ul") && html.includes("Use a | b | c"));
  assert.ok(html.includes("After | code | lost"));
});

test("block quotes, h4-h6 headings and tilde fences end the table and keep their full text", () => {
  for (const next of ["> Keep a | b | c intact.", "#### Keep a | b | c intact."]) {
    const parsed = parseMarkdown(`| A | B |\n| --- | --- |\n| one | two |\n${next}`, false, false, true);
    assert.equal(parsed.blocks.filter(b => b.cell).length, 4, next);
    assert.ok(parsed.plainText.endsWith("Keep a | b | c intact."), next);
  }
  const fenced = parseMarkdown("| A | B |\n| --- | --- |\n| one | two |\n~~~sql\nselect a | b | c\nfrom t | u\n~~~\nAfter | x | y", false, false, true);
  assert.equal(fenced.blocks.filter(b => b.cell).length, 4);
  assert.ok(fenced.plainText.includes("select a | b | c") && fenced.plainText.includes("from t | u") && fenced.plainText.endsWith("After | x | y"));
});

test("pipe lines inside a tilde fence never start a table", () => {
  const parsed = parseMarkdown("~~~\na | b\n- | -\n~~~\nz", false, false, true);
  assert.equal(parsed.blocks.filter(b => b.cell).length, 0);
  assert.ok(parsed.plainText.includes("a | b"));
});

test("the renderer keeps block-quote text complete after a table", async () => {
  const { render } = await renderer();
  const html = render("| A | B |\n| - | - |\n| one | two |\n> Keep a | b | c intact.\n~~~sql\nx | y | z\n~~~");
  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.ok(html.includes("Keep a | b | c intact.") && html.includes("x | y | z"));
});
