import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const { outputFiles } = await build({
  stdin: { contents: `
    import {createElement} from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import {OfficialExplanation} from './src/components/study/StudyKit';
    import QuestionContent from './src/components/QuestionContent';
    import MarkdownHighlightedText from './src/components/MarkdownHighlightedText';
    export {parseMarkdown} from './src/lib/markdown'; export {mdSegsFor} from './src/lib/annotations';
    export const render = (src, kind = 'official', tables) => renderToStaticMarkup(createElement(
      kind === 'official' ? OfficialExplanation : kind === 'question' ? QuestionContent : MarkdownHighlightedText,
      {src, explanation:src, tables, annotations:[], qid:'q', target:'ai', show:false}));
  `, loader: "tsx", resolveDir: fileURLToPath(new URL("../", import.meta.url)) },
  bundle: true, write: false, outfile: "official-explanation.mjs", platform: "node", format: "esm", jsx: "automatic",
  banner: { js: 'import {createRequire} from "node:module"; const require = createRequire(import.meta.url);' }
});
const dir = fileURLToPath(new URL("../node_modules/.cache/", import.meta.url));
mkdirSync(dir, { recursive: true });
const file = `${dir}official-explanation.test.mjs`;
writeFileSync(file, outputFiles.find(f => f.path.endsWith(".mjs")).text);
const { render, parseMarkdown, mdSegsFor } = await import(pathToFileURL(file).href);
const table = "| Left | Center | Right |\n| :--- | :---: | ---: |\n| **Bold** | x \\| y | `code \\| pipe` |\n| short |";

test("official explanations opt into semantic tables with alignment, inline markup and padded rows", () => {
  const html = render(table);
  assert.equal((html.match(/<table/g) ?? []).length, 1);
  assert.equal((html.match(/scope="col"/g) ?? []).length, 3);
  assert.equal((html.match(/<td /g) ?? []).length, 6);
  for (const align of ["left", "center", "right"]) assert.ok(html.includes(`text-align:${align}`));
  assert.ok(html.includes("font-weight:700") && html.includes("ui-monospace"));
  assert.ok(html.replace(/<[^>]*>/g, "").includes("x | ycode | pipe"));
  assert.ok(!html.includes(":---"));
  assert.ok(html.includes("overflow-x:auto"));
});

test("table syntax remains literal in stems/options and AI explanations", () => {
  for (const kind of ["question", "ai"]) {
    const html = render(table, kind);
    assert.ok(!html.includes("<table"), kind);
    assert.ok(html.includes(":---"), kind);
  }
});

test("official explanations retain safe links and literal HTML in table cells", () => {
  const html = render("| Safe | Unsafe | HTML |\n| --- | --- | --- |\n| [docs](https://example.test/a) | [bad](javascript:alert) | <img src=x onerror=alert(1)> |");
  assert.ok(html.includes('href="https://example.test/a"') && html.includes('rel="noreferrer noopener"'));
  assert.ok(!html.includes('href="javascript:') && !html.includes("<img"));
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("official prose without tables retains the same Markdown rendering and source offsets", () => {
  const src = "## Reasoning\n\nFirst **bold**\ncontinuation.\n\n- Item\n\n```text\nx | y\n```\n\n[docs](https://example.test) and <em>literal</em>.";
  assert.equal(render(src, "question", true), render(src, "question", false));
  assert.deepEqual(parseMarkdown(src, true, true, true), parseMarkdown(src, true, true, false));
});

test("official table parsing preserves surrounding blocks and source-coordinate annotations", () => {
  const cells = parseMarkdown(table, true, true, true);
  assert.ok(cells.blocks.some(b => b.cell && cells.plainText.slice(b.start, b.end) === "code | pipe"));
  for (const next of ["## After", "- After", "1. After", "> After", "---", "```\nAfter\n```", "\nAfter"]) {
    const parsed = parseMarkdown(`Before\n\n${table}\n${next}`, true, true, true);
    assert.equal(parsed.blocks.filter(b => b.cell).length, 9, next);
    assert.equal(parsed.plainText.slice(parsed.blocks[0].start, parsed.blocks[0].end), "Before");
    assert.ok(!parsed.blocks.at(-1).cell, next);
    if (next !== "---") assert.ok(parsed.plainText.endsWith("After"), next);
  }
  const src = `Before **intro** text.\n\n${table}\n\nAfter **marked** text.`;
  const parsed = parseMarkdown(src, true, true, true);
  for (const quote of ["intro", "Bold", "y", "code", "marked"]) {
    const start = src.indexOf(quote), end = start + quote.length;
    const segments = mdSegsFor(parsed, [{ id:quote, qid:"q", target:"stem", start, end, style:"underline", note:"" }], "q", "stem", true).flatMap(b => b.segs);
    const marked = segments.filter(s => s.annotationIds?.includes(quote));
    assert.equal(marked.map(s => s.text).join(""), quote);
    assert.equal(marked[0].off, start);
    assert.ok(marked.every(s => src.slice(s.off, s.off + s.text.length) === s.text));
  }
});
