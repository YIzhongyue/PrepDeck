import assert from "node:assert/strict";
import test from "node:test";
import { countMermaidFences, stripMarkdownToExcerpt } from "./knowledgePointExcerpt.ts";

test("strips heading markers", () => {
  assert.equal(stripMarkdownToExcerpt("# Title\nBody text here."), "Title Body text here.");
});

test("strips raw HTML tags rather than showing them literally (implementation)", () => {
  assert.equal(
    stripMarkdownToExcerpt('Before. <div class="callout">Inside</div> After.'),
    "Before. Inside After."
  );
});

test("strips bold/italic emphasis (both * and _ forms)", () => {
  assert.equal(
    stripMarkdownToExcerpt("This is **bold** and *italic* and _also italic_ and __also bold__."),
    "This is bold and italic and also italic and also bold."
  );
});

test("links keep the visible text and drop the URL", () => {
  assert.equal(stripMarkdownToExcerpt("See [the docs](https://example.com/docs) for details."), "See the docs for details.");
});

test("images are dropped entirely, not left as artifacts", () => {
  const excerpt = stripMarkdownToExcerpt("Before ![a diagram](https://example.com/img.png) after.");
  assert.equal(excerpt, "Before after.");
});

test("fenced code blocks (including mermaid) are dropped, not shown as code", () => {
  const excerpt = stripMarkdownToExcerpt("Before.\n```js\nconst x = 1;\n```\nAfter.");
  assert.equal(excerpt, "Before. After.");
  assert.ok(!excerpt.includes("const x"));
});

test("inline code backticks are stripped, keeping the code text", () => {
  assert.equal(stripMarkdownToExcerpt("Run `npm test` first."), "Run npm test first.");
});

test("blockquote and list markers are stripped", () => {
  assert.equal(stripMarkdownToExcerpt("> A quote\n- item one\n1. item two"), "A quote item one item two");
});

test("tables are flattened and separator rows dropped", () => {
  assert.equal(stripMarkdownToExcerpt("| A | B |\n| - | - |\n| 1 | 2 |"), "A B 1 2");
});

test("truncates at a word boundary with an ellipsis when over the limit", () => {
  assert.equal(stripMarkdownToExcerpt("This is a long sentence that keeps going.", 20), "This is a long…");
});

test("does not truncate text at or under the limit", () => {
  assert.equal(stripMarkdownToExcerpt("Short.", 20), "Short.");
});

test("collapses runs of whitespace left behind by stripped syntax", () => {
  assert.equal(stripMarkdownToExcerpt("Word1\n\n\nWord2"), "Word1 Word2");
});

test("empty body yields an empty excerpt", () => {
  assert.equal(stripMarkdownToExcerpt(""), "");
});

test("countMermaidFences: zero for a body with no fences", () => {
  assert.equal(countMermaidFences("Just text, no code."), 0);
});

test("countMermaidFences: ignores non-mermaid fences", () => {
  assert.equal(countMermaidFences("```js\nconst x = 1;\n```"), 0);
});

test("countMermaidFences: counts a single mermaid fence", () => {
  assert.equal(countMermaidFences("```mermaid\nflowchart TD\nA-->B\n```"), 1);
});

test("countMermaidFences: counts multiple mermaid fences and ignores other fences between them", () => {
  const body = "```mermaid\nflowchart TD\nA-->B\n```\n```js\nconst x=1;\n```\n```mermaid\ngraph LR\nC-->D\n```";
  assert.equal(countMermaidFences(body), 2);
});

test("countMermaidFences: is case-insensitive on the fence info string", () => {
  assert.equal(countMermaidFences("```Mermaid\nflowchart TD\nA-->B\n```"), 1);
});
