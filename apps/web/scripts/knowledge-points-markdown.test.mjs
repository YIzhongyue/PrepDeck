import test from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";
import { escapeParagraphMarkdown, prepareMarkdown, fencedSource, imageAltText, markdownImage, pasteContent, plainTextContent, safeUrl, SOURCE_LANGUAGE } from "../src/components/knowledgePoints/editorMarkdown.ts";
import { preserveUnsupportedMarkdown } from "../src/lib/preserveUnsupportedMarkdown.ts";

test("ordinary Markdown remains visual while raw inline and block HTML stay literal", () => {
  const source = '# Heading\n\n**Strong** and *emphasis*.\n\nBefore <span data-x="1">literal</span> after.\n\n<div>block</div>\n';
  const prepared = prepareMarkdown(source);
  const tokens = marked.lexer(prepared);
  assert.equal(tokens[0].type, "heading");
  const raw = tokens.filter(t => t.type === "code" && t.lang === SOURCE_LANGUAGE);
  assert.equal(raw.length, 2);
  assert.equal(raw[0].text, 'Before <span data-x="1">literal</span> after.');
  assert.equal(raw[1].text, "<div>block</div>");
});

test("reference definitions and footnotes survive as editable source", () => {
  const reference = "See [the guide][guide].\n\n[guide]: https://example.test/guide\n";
  assert.equal(marked.lexer(prepareMarkdown(reference))[0].text, reference);
  const footnote = "Note[^one].\n\n[^one]: exact footnote text";
  const result = marked.lexer(prepareMarkdown(footnote));
  assert.equal(result.filter(t => t.type === "code").map(t => t.text).join("\n\n"), footnote);
});

test("code fences containing shorter fences preserve the original source", () => {
  const code = 'const text = "```";\n~~~mermaid\nline';
  const token = marked.lexer(fencedSource(code, "javascript"))[0];
  assert.equal(token.text, code);
  assert.equal(token.lang, "javascript");
});

test("literal code using the internal source language retains its fence", () => {
  const source = "```prepdeck-source\n# Literal code\n```";
  assert.equal(marked.lexer(prepareMarkdown(source))[0].text, source);
});

test("linked images keep their enclosing destination as editable source", () => {
  const source = "[![linked screenshot](https://example.test/image.png)](https://example.test/page)";
  assert.equal(marked.lexer(prepareMarkdown(source))[0].text, source);
});

test("image alt punctuation and stable attachment references roundtrip", () => {
  const image = markdownImage('Panel [A] \\ done', '/api/kp-images/attachment', 'the "diagram"');
  const token = marked.lexer(image)[0].tokens[0];
  assert.equal(token.type, "image");
  assert.equal(imageAltText(token), 'Panel [A] \\ done');
  assert.equal(token.href, "/api/kp-images/attachment");
  assert.equal(token.title, 'the "diagram"');
});

test("unsafe schemes are preserved as source instead of becoming executable nodes", () => {
  assert.equal(safeUrl("javascript:alert(1)"), false);
  assert.equal(safeUrl("data:text/html,hello"), false);
  assert.equal(safeUrl("https://example.test"), true);
  assert.equal(marked.lexer(prepareMarkdown('[unsafe](javascript:alert%281%29)'))[0].lang, SOURCE_LANGUAGE);
});

test("preview keeps inline HTML visible without executing it", () => {
  const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "html", value: '<img onerror="alert(1)">' }] }] };
  preserveUnsupportedMarkdown()(tree);
  assert.deepEqual(tree.children[0].children[0], { type: "inlineCode", value: '<img onerror="alert(1)">' });
});

test("bracket pairs in ordinary prose stay visually editable", () => {
  // These are not reference links, and freezing them dropped a whole paragraph
  // of a technical note into source mode.
  for (const source of ["Use matrix[0][1] here.", 'Read config["a"]["b"] too.', "Match [^abc] with a character class."]) {
    const tokens = marked.lexer(prepareMarkdown(source));
    assert.equal(tokens[0].type, "paragraph", source);
    assert.equal(tokens[0].raw.trim(), source);
  }
});

test("a footnote is preserved only when its definition is present", () => {
  const defined = marked.lexer(prepareMarkdown("Cited[^a] here.\n\n[^a]: the note"));
  assert.deepEqual(defined.filter(t => t.type === "code").map(t => t.lang), [SOURCE_LANGUAGE, SOURCE_LANGUAGE]);
  // Same bracket shape, no definition anywhere: ordinary text, not a footnote.
  const undefinedRef = marked.lexer(prepareMarkdown("Cited[^a] here."));
  assert.equal(undefinedRef[0].type, "paragraph");
});

test("image alt text and titles cannot break out of their own construct", () => {
  const token = marked.lexer(markdownImage("first\nsecond", "/api/kp-images/x", "a\ntitle"))[0].tokens[0];
  assert.equal(token.type, "image");
  assert.equal(imageAltText(token), "first second");
  assert.equal(token.title, "a title");
});

// Pasting into the middle of a paragraph used to split it in two: the pasted
// text was handed to the editor as Markdown, "NEW" lexes to a paragraph, and
// inserting a paragraph inside one breaks it apart. pasteContent decides
// whether what arrived is block structure at all.
test("a paste with no block structure of its own joins the paragraph it lands in", () => {
  assert.deepEqual(pasteContent({ content: [{ type: "paragraph", content: [{ type: "text", text: "NEW" }] }] }),
    [{ type: "text", text: "NEW" }]);
});

test("inline formatting survives being unwrapped", () => {
  const marks = [{ type: "bold" }];
  assert.deepEqual(pasteContent({ content: [{ type: "paragraph", content: [{ type: "text", text: "literal example", marks }] }] }),
    [{ type: "text", text: "literal example", marks }]);
});

test("genuine block structure is still inserted as blocks", () => {
  for (const type of ["heading", "bulletList", "blockquote", "codeBlock", "table", "image"]) {
    const block = { type, content: [{ type: "text", text: "x" }] };
    assert.deepEqual(pasteContent({ content: [block] }), [block], type);
  }
  const two = [{ type: "heading", content: [] }, { type: "paragraph", content: [] }];
  assert.deepEqual(pasteContent({ content: two }), two, "several blocks are never unwrapped");
});

test("an empty parse inserts nothing rather than throwing", () => {
  assert.deepEqual(pasteContent({}), []);
  assert.deepEqual(pasteContent({ content: [] }), []);
  assert.deepEqual(pasteContent({ content: [{ type: "paragraph" }] }), []);
});

test("a nonempty whitespace clipboard is retained when Markdown parses no nodes", () => {
  assert.deepEqual(pasteContent({ content: [] }, "   "), [{ type: "text", text: "   " }]);
});

test("the plain-text offer makes the same distinction", () => {
  // Accepting the offer must not re-introduce the split the Markdown path
  // just stopped making.
  assert.deepEqual(plainTextContent("NEW"), [{ type: "text", text: "NEW" }]);
  assert.deepEqual(plainTextContent("**literal**"), [{ type: "text", text: "**literal**" }]);
  assert.deepEqual(plainTextContent("one\ntwo"), [
    { type: "paragraph", content: [{ type: "text", text: "one" }] },
    { type: "paragraph", content: [{ type: "text", text: "two" }] },
  ]);
  assert.deepEqual(plainTextContent("a\n\nb"), [
    { type: "paragraph", content: [{ type: "text", text: "a" }] },
    { type: "paragraph", content: [] },
    { type: "paragraph", content: [{ type: "text", text: "b" }] },
  ]);
});

test("literal paragraph markers remain text when saved Markdown is parsed again", () => {
  for (const text of ["# Heading", "- item", "+ item", "1. item", "1) item", "---", "==="]) {
    const tokens = marked.lexer(escapeParagraphMarkdown(text));
    assert.equal(tokens.length, 1, text);
    assert.equal(tokens[0].type, "paragraph", text);
    assert.equal(tokens[0].tokens.map(token => token.text).join(""), text);
  }
  assert.equal(escapeParagraphMarkdown("**bold** and `code`"), "**bold** and `code`");
});
