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
