import test from "node:test";
import assert from "node:assert/strict";
import { createScanner, SyntaxKind } from "jsonc-parser";
import { importTs } from "../../../tests/support/bundle.mjs";

const { formatJsonSource } = await importTs(new URL("../src/lib/formatJsonSource.ts", import.meta.url), { platform: "node", mainFields: ["module","main"] });
const caret = start => ({ start, end:start, direction:"none" });
const tokens = text => {
  const scanner = createScanner(text, false), result = [];
  for (let kind = scanner.scan(); kind !== SyntaxKind.EOF; kind = scanner.scan()) {
    if (kind !== SyntaxKind.Trivia && kind !== SyntaxKind.LineBreakTrivia) {
      assert.equal(scanner.getTokenError(), 0);
      const start = scanner.getTokenOffset(), end = start + scanner.getTokenLength();
      result.push({kind, raw:text.slice(start,end), start, end});
    }
  }
  return result;
};
const rawTokens = text => tokens(text).map(({kind,raw})=>({kind,raw}));

test("formatting preserves every raw token, including duplicate keys, numbers, escapes and unknown fields", () => {
  const sources = [
    String.raw`{"id":"first","id":"second","unknown":{"id":"nested","large":900719925474099312345678901234567890,"overflow":1e400,"underflow":1e-400,"negativeZero":-0,"decimal":1.2300,"exponent":1E+005},"ordered":[3,2,1]}`,
    String.raw`{"escapes":"\u0061\uD83E\uDD8A\/\\\"\b\f\n\r\t","literal":"🦊 日本語","\u0069d":"escaped-key","nested":[{},[],[{"x":null,"x":false}],true]}`,
    String.raw`{" spaced key ":"  leading and interior   spaces  ","escaped":"\t tab\t\n newline\n\r\n end ","empty":"","spaces":"    "}`,
    " \r\n{\r\n\t\"id\" : \"CRLF\", \"array\":[ 2 , 1 ]\r\n}\r\n ",
    "[ 1, 2, { \"x\" : [ 3 ] } ]", " {} ", " [] ", "1e400", "-0", '"\\u0061"', "null", "false"
  ];
  for (const source of sources) {
    const result = formatJsonSource(source, caret(0));
    assert.ok(result);
    assert.deepEqual(rawTokens(result.text),rawTokens(source));
    assert.deepEqual(JSON.parse(result.text),JSON.parse(source));
    assert.equal(formatJsonSource(result.text,result.selection).text,result.text,"Repeated formatting is a no-op");
  }
  const crlf = formatJsonSource(sources[3],caret(0)).text;
  assert.ok(crlf.includes("\r\n  \"id\": \"CRLF\""));
  assert.ok(!/(?<!\r)\n/.test(crlf),"The existing CRLF style survives");
  assert.equal(formatJsonSource('{"a":1,"b":[2,3]}',caret(0)).text,'{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}');
});

test("malformed JSON is rejected without formatting tolerant JSONC or partial content", () => {
  for (const source of ["", " ", "{", "[1,]", '{"a":1,}', '/* comment */{}', '// comment\n{}', '{"a":01}', '{"a":1e}', '"bad\\q"', '{} {}', '\ufeff{}', '{"a":"line\nline"}']) {
    assert.throws(()=>JSON.parse(source),SyntaxError);
    assert.equal(formatJsonSource(source,caret(0)),undefined,source);
  }
});

test("selection mapping preserves raw token selections and UTF-16 caret offsets in both directions", () => {
  const source = String.raw`{ "id" : "🦊\u0061", "id":"second", "numbers":[-0,1.2300,1e400] }`;
  const original = tokens(source), formatted = tokens(formatJsonSource(source,caret(0)).text);
  for (const [i,token] of original.entries()) {
    for (const direction of ["forward","backward"]) {
      const result = formatJsonSource(source,{start:token.start,end:token.end,direction});
      assert.equal(result.text.slice(result.selection.start,result.selection.end),token.raw);
      assert.equal(result.selection.direction,direction);
      assert.equal(result.selection.start,formatted[i].start);
      assert.equal(result.selection.end,formatted[i].end);
    }
    for (let relative=0;relative<token.raw.length;relative++) {
      const result = formatJsonSource(source,caret(token.start+relative));
      assert.equal(result.selection.start,formatted[i].start+relative);
      assert.deepEqual(result.selection,caret(formatted[i].start+relative));
    }
  }
});

test("positions within replaced whitespace stay bounded and selections do not reverse", () => {
  const source = '\t {  "a"    :  [ 1 ,  2 ]   }   ';
  for (let start=0;start<=source.length;start++) for(let end=start;end<=source.length;end++) {
    const result = formatJsonSource(source,{start,end,direction:start===end?"none":"backward"});
    assert.ok(result.selection.start>=0 && result.selection.end<=result.text.length);
    assert.ok(result.selection.start<=result.selection.end);
  }
});

test("semantic validity is unrelated to formatting eligibility", () => {
  const source = '{"schemaVersion":"2.0","questions":[],"unknown":true,"unknown":false}';
  const result = formatJsonSource(source,caret(0));
  assert.ok(result.text.includes('\n  "questions": []'));
  assert.deepEqual(rawTokens(result.text),rawTokens(source));
});
