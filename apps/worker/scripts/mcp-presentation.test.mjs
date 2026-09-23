import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { componentQuestion, presentationRow, paragraph } from "../../../tests/fixtures/mcp-presentation/question.mjs";

const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL("../src/mcp/questionPresentation.ts", import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
const { presentQuestion } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
const text = result => result.content.filter(c => c.type === "text").slice(1).map(c => c.text).join("\n\n");

test("full shared material retains tables, original pixels, code, source omissions and combination labels without grading fields", () => {
  const content = componentQuestion(), result = presentQuestion(presentationRow(content), "inline");
  const metadata = result.structuredContent.data;
  assert.equal(metadata.status, "available");
  assert.equal(metadata.sourceLayoutVerified, false);
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(metadata.revision, 7);
  assert.equal(result.content.filter(c => c.type === "image").length, 2);
  for (const [index, figure] of metadata.figures.entries()) {
    assert.deepEqual(result.content[figure.imageContentIndex], { type: "image", data: content.assets[index].data, mimeType: "image/png" });
    assert.ok(text(result).includes(`Figure ${index + 1}`));
  }
  const output = text(result);
  assert.match(output, /\| System \| Interval \| Retention \|\n\| --- \| --- \| --- \|/);
  assert.match(output, /\| Primary &#124; A \| 7 days \| 2 generations \|/);
  assert.match(output, /Line 1<br>Line 2/);
  assert.match(output, /````python\nif changed:\n    print\("```", "__"\)/);
  assert.match(output, /### ア\n\n- \*\*i\*\*: Review interval\n- \*\*ii\*\*: Review retention/);
  assert.match(output, /省略/);
  assert.ok(output.indexOf("Shared material") < output.indexOf("## Question"));
  assert.ok(output.indexOf("Figure 2") < output.indexOf("## Options"));
  assert.doesNotMatch(JSON.stringify(result), /SENTINEL|FLATTENED|correctAnswers|scoring/);
  assert.equal(JSON.stringify(result.structuredContent).includes(content.assets[0].data), false, "base64 is not duplicated into metadata");
});

test("text-only and missing/corrupt images explicitly mark incomplete material without invented substitutes", () => {
  for (const variant of ["text-only", "missing", "corrupt"]) {
    const content = componentQuestion();
    if (variant === "missing") content.assets = [];
    if (variant === "corrupt") content.assets[0].data = "AAAA";
    const result = presentQuestion(presentationRow(content), variant === "text-only" ? "text-only" : "inline");
    assert.equal(result.structuredContent.data.status, "incomplete");
    assert.ok(result.structuredContent.data.warnings.includes(variant === "text-only" ? "image_not_displayed" : "missing_asset"));
    assert.match(text(result), /Image description only:/);
    assert.equal(result.content.filter(c => c.type === "image").length, variant === "corrupt" ? 1 : 0);
    assert.equal(result.structuredContent.data.figures[0].imageContentIndex, null);
    assert.doesNotMatch(text(result), /data:image|file:\/\/|!\[|FLATTENED/);
  }
});

test("invalid snapshots, incomplete tables and member references fail visibly instead of using projections", () => {
  const variants = [null, { ...componentQuestion(), version: "future" }, { ...componentQuestion(), scoring: { correctAnswers: ["SENTINEL"] } }];
  const missingMaterial = componentQuestion(); delete missingMaterial.stimuli; variants.push(missingMaterial);
  const ragged = componentQuestion(); ragged.stimuli[0].body[2].rows[0].pop(); variants.push(ragged);
  const missingMember = componentQuestion(); missingMember.interaction.options[0].memberRefs = ["absent"]; variants.push(missingMember);
  const duplicate = componentQuestion(); duplicate.assets.push(duplicate.assets[0]); variants.push(duplicate);
  for (const content of variants) {
    const result = presentQuestion(presentationRow(content), "inline");
    assert.equal(result.structuredContent.data.status, "incomplete");
    assert.match(text(result), /Presentation incomplete:/);
    assert.doesNotMatch(JSON.stringify(result), /FLATTENED|SENTINEL/);
  }
  const row = presentationRow(); row.content_json = "{";
  assert.equal(presentQuestion(row, "inline").structuredContent.data.status, "incomplete");
});

test("match and order display every side/item in stored order without fabricating pairings or sorted answers", () => {
  const options = ["Z", "A"].map(id => ({ id, body: [paragraph(`option-${id}`, `Item ${id}`)] }));
  for (const type of ["order", "match", "text"]) {
    const content = componentQuestion();
    content.interaction = type === "text" ? { id: "answer", type } : type === "order" ? { id: "answer", type, options }
      : { id: "answer", type, left: options, right: [{ id: "X", body: [paragraph("x", "Right X")] }, { id: "Y", body: [paragraph("y", "Right Y")] }] };
    const result = presentQuestion(presentationRow(content), "inline"), output = text(result);
    assert.equal(result.structuredContent.data.status, "available");
    if (type === "text") assert.match(output, /Provide a text response/);
    else assert.ok(output.indexOf("### Z") < output.indexOf("### A"));
    if (type === "match") { assert.match(output, /Match — left/); assert.match(output, /Match — right/); assert.match(output, /Right Y/); }
  }
});

test("repeated images share bytes but each figure retains caption and a valid content index", () => {
  const content = componentQuestion();
  content.body.push({ ...content.stimuli[0].body[1], id: "repeated-figure", caption: "Same source used again" });
  const result = presentQuestion(presentationRow(content), "inline"), figures = result.structuredContent.data.figures;
  assert.equal(result.content.filter(c => c.type === "image").length, 2);
  assert.equal(figures[0].imageContentIndex, figures[2].imageContentIndex);
  assert.match(text(result), /Same source used again/);
});

test("code with an existing terminal newline does not gain a blank line", () => {
  const content = componentQuestion();
  content.body[1].text = "  preserve indentation\n";
  const result = presentQuestion(presentationRow(content), "inline");
  assert.ok(result.content.some(c => c.type === "text" && c.text === "```python\n  preserve indentation\n```"));
});

test("legacy Markdown survives across exams, with explicit layout uncertainty and no answer fields", () => {
  for (const exam_id of ["sg", "aws"]) {
    const stem = "Source paragraph\n\n| Header | Value |\n| --- | --- |\n| a | b |\n\n```text\n  preserved\n```";
    const row = { ...presentationRow(), exam_id, content_json: null, stem, options_json: '[{"id":"ア","text":"**Original emphasis**","correct":true}]' };
    const result = presentQuestion(row, "inline");
    assert.equal(result.structuredContent.data.examId, exam_id);
    assert.deepEqual(result.structuredContent.data.warnings, ["legacy_layout_unverified"]);
    assert.ok(text(result).includes(stem));
    assert.match(text(result), /### ア\n\n\*\*Original emphasis\*\*/);
    assert.doesNotMatch(JSON.stringify(result), /SENTINEL|"correct"/);
    row.options_json = "{";
    assert.equal(presentQuestion(row, "inline").structuredContent.data.status, "incomplete");
  }
});
