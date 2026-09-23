import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const bundle = async path => {
  const { outputFiles } = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], bundle: true, write: false, platform: "node", format: "esm" });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
};
const [{ reflowPlainProse }, { parseMarkdown }, { mdSegsFor }] = await Promise.all([bundle("../src/lib/prose.ts"), bundle("../src/lib/markdown.ts"), bundle("../src/lib/annotations.ts")]);

test("PDF layout lines reflow Japanese/mixed prose without Japanese spaces or joined Latin words", () => {
  for (const [source, expected] of [
    ["hostsファ\nイルを確認する。", "hostsファイルを確認する。"],
    ["日本\n語とPC\nの設定。", "日本語とPCの設定。"],
    ["Read the\nnext line.\nA new sentence.", "Read the next line. A new sentence."],
    ["𠮷\n野家", "𠮷野家"],
    ["最初の\n段落。\n\nNext\nparagraph.", "最初の段落。\n\nNext paragraph."],
    ["CRLF\r\ntext", "CRLF text"],
  ]) {
    assert.equal(reflowPlainProse(source), expected);
    const parsed = parseMarkdown(source, true, true);
    assert.equal(parsed.blocks.map(b => parsed.plainText.slice(b.start, b.end)).join("\n\n"), expected);
  }
});

test("structured-looking plain text is conservative; Markdown hard breaks and fenced code remain intentional", () => {
  for (const source of ["1. First\n2. Second", "- one\n- two", "A | B\nC | D", "x = y + z\na = b", "    read()\n    write()", "$$\nx + y\nz + w\n$$", "first  \nsecond", "first\\\nsecond"]) assert.equal(reflowPlainProse(source), source);
  const parsed = parseMarkdown("first  \nsecond\\\nthird\nfourth\n\n```python\nif ready:\n    use()\n```\n\n- First\n- Second", true, true);
  assert.deepEqual(parsed.blocks.map(b => [b.type, parsed.plainText.slice(b.start, b.end)]), [
    ["p", "first"], ["p", "second"], ["p", "third fourth"], ["code", "if ready:\n    use()"], ["li", "First"], ["li", "Second"],
  ]);
  assert.equal(parseMarkdown("x = y\na = b", true, true).blocks.length, 2);
  assert.equal(parseMarkdown("    C:\\\n    D:\\", true, true).plainText, "C:\\D:\\");
  assert.equal(parseMarkdown("~~~\nfirst\nsecond\n~~~", true, true).blocks.length, 4);
});

test("reflow keeps persisted annotation coordinates across removed CJK LFs and Latin separator spaces", () => {
  const source = "**hostsファ\nイル** and English\nwords.\n\nNext paragraph.";
  // An annotation may cross an extraction line ending in the original source.
  const start = source.indexOf("ファ"), end = source.indexOf("** and");
  const parsed = parseMarkdown(source, true, true);
  assert.equal(parsed.plainText, "hostsファイル and English words.Next paragraph.");
  assert.ok(parsed.inline.some(range => range.kind === "bold" && parsed.plainText.slice(range.start, range.end) === "hostsファイル"));
  const marks = [{ id: "persisted", qid: "q", target: "stem", start, end, style: "hl1", note: "Retained mark" }];
  const segments = mdSegsFor(parsed, marks, "q", "stem", true).flatMap(b => b.segs);
  const marked = segments.filter(s => s.annotationIds?.includes("persisted"));
  assert.equal(marked.map(s => s.text).join(""), "ファイル");
  assert.equal(marked[0].off, start);
  assert.equal(marked.at(-1).off + marked.at(-1).text.length, end);
  assert.ok(parsed.sourceOffsets.every((offset, i) => (i === 0 || offset > parsed.sourceOffsets[i - 1])
    && (source[offset] === parsed.plainText[i] || source[offset] === "\n" && parsed.plainText[i] === " ")));
  assert.equal(source, "**hostsファ\nイル** and English\nwords.\n\nNext paragraph.");
});

test("existing AI display offsets and non-opted-in Markdown behavior remain unchanged", () => {
  const parsed = parseMarkdown("**bold**\nnext");
  assert.equal(parsed.plainText, "boldnext"); assert.equal(parsed.sourceOffsets, undefined);
  assert.equal(parsed.blocks.length, 2);
});
