import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

async function bundle(path) {
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const { blankQuestion, formPayload, questionForm } = await bundle("../src/lib/questionAuthoring.ts");
const { parseMarkdown } = await bundle("../src/lib/markdown.ts");
const { mdSegsFor } = await bundle("../src/lib/annotations.ts");
const { normalizeTagName } = await bundle("../../../packages/shared/src/questionTags.ts");

test("continuous authoring resets content, answers, IDs and metadata while retaining each type", () => {
  for (const type of ["single_choice", "multiple_choice", "true_false", "fill_blank"]) {
    const blank = blankQuestion(type);
    assert.equal(blank.type, type);
    for (const field of ["stem", "externalId", "explanation", "difficulty"]) assert.equal(blank[field], "");
    assert.deepEqual(blank.tags, []);
    assert.deepEqual(blank.correctAnswers, []); assert.equal(blank.points, "1");
    if (type === "true_false") assert.deepEqual(blank.options.map(o => o.id), ["true", "false"]);
    else assert.ok(blank.options.every(o => o.text === ""));
  }
  // No shared mutable options, answers or tags between questions.
  const first = blankQuestion(); first.options[0].text = "old"; first.correctAnswers.push("A"); first.tags.push("old");
  assert.equal(blankQuestion().options[0].text, ""); assert.deepEqual(blankQuestion().correctAnswers, []); assert.deepEqual(blankQuestion().tags, []);
});
test("editor serializes zero points and deliberately clears optional fields without JSON input", () => {
  const form = questionForm({ ...blankQuestion(), externalId: "Q1", difficulty: null, tags: ["one", "two"], points: 0 });
  assert.equal(formPayload(form).points, 0); assert.deepEqual(formPayload(form).tags, ["one", "two"]);
  assert.ok(Number.isNaN(formPayload({ ...form, points: "" }).points));
  assert.equal(formPayload({ ...form, type: "fill_blank", correctAnswers: ["A"] }).options, undefined);
});

test("tag arrays preserve commas, existing names and explicit removal through the save payload", () => {
  const tags = ["Cloud, data", "Existing tag", "標籤"];
  const form = questionForm({ ...blankQuestion(), tags, points: 1 });
  assert.deepEqual(form.tags, tags);
  assert.deepEqual(formPayload(form).tags, tags);
  assert.deepEqual(formPayload({ ...form, tags: [] }).tags, []);
  // Editing the form must not change the original question before it is saved.
  form.tags.push("new tag");
  assert.deepEqual(tags, ["Cloud, data", "Existing tag", "標籤"]);
});
test("canonical tag names with a literal leading hash survive API normalization on every save", () => {
  const tags = ["#literal", "##literal", "Cloud, data"];
  let form = questionForm({ ...blankQuestion(), tags, points: 1 });
  for (let save = 0; save < 2; save++) {
    const payload = formPayload(form);
    assert.deepEqual(payload.tags, ["##literal", "###literal", "Cloud, data"]);
    const savedTags = payload.tags.map(normalizeTagName);
    assert.deepEqual(savedTags, tags);
    form = questionForm({ ...blankQuestion(), tags: savedTags, points: 1 });
  }
});
test("Markdown question content preserves raw source coordinates for existing annotations", () => {
  const src = "# **Title**\n\nA *word* and `code`.\n- Item\n\n```\n\nraw **text**\n```";
  const parsed = parseMarkdown(src, true);
  assert.ok(parsed.sourceOffsets.every((off, i) => src[off] === parsed.plainText[i]));
  const start = src.indexOf("word");
  const annotations = [{ id: "old", qid: "q", target: "stem", start, end: start + 4, style: "bold", note: "" }];
  const segments = mdSegsFor(parsed, annotations, "q", "stem", true).flatMap(b => b.segs);
  assert.ok(segments.some(s => s.text === "word" && s.off === start && s.annotationIds.includes("old")));
  for (const seg of segments) assert.equal(src.slice(seg.off, seg.off + seg.text.length), seg.text);
});
test("AI Markdown retains its existing display coordinate system", () => {
  const parsed = parseMarkdown("**bold**\nnext");
  assert.equal(parsed.plainText, "boldnext"); assert.equal(parsed.sourceOffsets, undefined);
});
test("Markdown links render as safe anchors while keeping raw source coordinates", () => {
  const src = "Reference: [File-size **tuning**](https://docs.databricks.com/aws/en/tables/tune-file-size)\n参见 https://example.com/a_b_c(1)。 [x](javascript:alert(1))";
  const parsed = parseMarkdown(src, true);
  assert.ok(parsed.sourceOffsets.every((off, i) => src[off] === parsed.plainText[i]));
  const links = parsed.inline.filter(r => r.kind === "link").map(r => [parsed.plainText.slice(r.start, r.end), r.href]);
  assert.deepEqual(links, [
    ["File-size tuning", "https://docs.databricks.com/aws/en/tables/tune-file-size"],
    ["https://example.com/a_b_c(1)", "https://example.com/a_b_c(1)"],
  ]);
  assert.ok(parsed.inline.some(r => r.kind === "bold" && parsed.plainText.slice(r.start, r.end) === "tuning"));
  assert.ok(parsed.plainText.includes("[x](javascript:alert(1))"));
  const segs = mdSegsFor(parsed, [], "q", "stem", false).flatMap(b => b.segs);
  assert.ok(segs.some(s => s.text === "tuning" && s.href === "https://docs.databricks.com/aws/en/tables/tune-file-size" && s.weight === "700"));
  assert.equal(parseMarkdown("see (https://a.com/x).").inline[0].href, "https://a.com/x");
});
test("AI annotations saved before link parsing keep their legacy display coordinates", () => {
  const src = "See [docs](https://example.com) then remember this important rule.";
  // Offsets the pre-link parser assigned: the link stayed literal, so plainText === src.
  const start = src.indexOf("remember");
  assert.deepEqual([start, start + 8], [37, 45]);
  const parsed = parseMarkdown(src);
  assert.ok(!parsed.plainText.includes("]("));
  const annotations = [{ id: "legacy", qid: "q", target: "ai", start, end: start + 8, style: "bold", note: "" }];
  const segs = mdSegsFor(parsed, annotations, "q", "ai", true).flatMap(b => b.segs);
  assert.deepEqual(segs.filter(s => s.annotationIds.includes("legacy")).map(s => s.text).join(""), "remember");
  // New marks are captured from data-off, which stays in the same legacy space.
  for (const seg of segs) assert.equal(src.slice(seg.off, seg.off + seg.text.length), seg.text);
  assert.equal(parseMarkdown("**bold** without links").sourceOffsets, undefined);
});
test("link labels with astral characters keep monotonic UTF-16 source offsets", () => {
  const src = "Read [📘 docs](https://example.com) now";
  for (const parsed of [parseMarkdown(src, true), parseMarkdown(src)]) {
    assert.equal(parsed.plainText, "Read 📘 docs now");
    assert.ok(parsed.sourceOffsets.every((off, i) => src[off] === parsed.plainText[i]));
    assert.ok(parsed.sourceOffsets.every((off, i, all) => i === 0 || off > all[i - 1]));
    const segs = mdSegsFor(parsed, [], "q", "stem", false).flatMap(b => b.segs);
    for (const seg of segs) assert.equal(src.slice(seg.off, seg.off + seg.text.length), seg.text);
    // Capturing the final "s" of "docs" resolves to its source offset.
    const docs = segs.find(s => s.text.endsWith("docs"));
    assert.equal(docs.off + docs.text.length - 1, src.indexOf("s]"));
  }
  const start = src.indexOf("now");
  const annotations = [{ id: "a", qid: "q", target: "stem", start, end: start + 3, style: "bold", note: "" }];
  const marked = mdSegsFor(parseMarkdown(src, true), annotations, "q", "stem", true).flatMap(b => b.segs).filter(s => s.annotationIds.includes("a"));
  assert.equal(marked.map(s => s.text).join(""), "now");
});
test("underscores inside identifiers stay literal; escapes and real emphasis still work (issue #108)", () => {
  const literal = (src) => {
    const parsed = parseMarkdown(src, true);
    assert.ok(parsed.sourceOffsets.every((off, i) => src[off] === parsed.plainText[i]), src);
    return parsed;
  };
  for (const src of ["Use new_events and event_id.", "new_events contains records and event_id is unique.",
    "question_bank_tag, some_long_python_variable and AWS_S3_BUCKET", "foo__bar__baz", "中文_标识_符"]) {
    const parsed = literal(src);
    assert.equal(parsed.plainText, src);
    assert.deepEqual(parsed.inline, [], src);
  }
  assert.equal(literal("Use new\\_events and event\\_id.").plainText, "Use new_events and event_id.");
  assert.equal(literal("\\*not italic\\* and \\`not code\\`").plainText, "*not italic* and `not code`");
  assert.equal(literal("_a \\_ b_").plainText, "a _ b", "an escaped marker never closes emphasis");
  // Other backslashes stay: LaTeX delimiters, paths.
  assert.equal(literal("\\( x \\) at \\\\server\\share").plainText, "\\( x \\) at \\\\server\\share");

  const emphasis = (src) => { const parsed = literal(src); return [parsed.plainText, parsed.inline.map(r => [r.kind, parsed.plainText.slice(r.start, r.end)])]; };
  assert.deepEqual(emphasis("This is _important_."), ["This is important.", [["italic", "important"]]]);
  assert.deepEqual(emphasis("This is *important*."), ["This is important.", [["italic", "important"]]]);
  assert.deepEqual(emphasis("**important** and __also__"), ["important and also", [["bold", "important"], ["bold", "also"]]]);
  assert.deepEqual(emphasis("`new_events` here"), ["new_events here", [["code", "new_events"]]]);
  assert.deepEqual(emphasis("_snake_case name_"), ["snake_case name", [["italic", "snake_case name"]]]);
  assert.deepEqual(emphasis("a*b*c"), ["abc", [["italic", "b"]]], "* still works inside words");
});
test("AI annotations saved before #108 keep their legacy display coordinates", () => {
  const src = "The view new_events feeds event_id, then remember this rule.";
  // The old parser read "_events feeds event_" as italics and dropped both underscores.
  const legacyText = "The view newevents feeds eventid, then remember this rule.";
  const start = legacyText.indexOf("remember");
  const parsed = parseMarkdown(src);
  assert.equal(parsed.plainText, src);
  const annotations = [{ id: "legacy", qid: "q", target: "ai", start, end: start + 8, style: "bold", note: "" }];
  const segs = mdSegsFor(parsed, annotations, "q", "ai", true).flatMap(b => b.segs);
  assert.equal(segs.filter(s => s.annotationIds.includes("legacy")).map(s => s.text).join(""), "remember");
  assert.equal(parseMarkdown("plain_text without changes").sourceOffsets, undefined, "unchanged text keeps plain display offsets");
});
