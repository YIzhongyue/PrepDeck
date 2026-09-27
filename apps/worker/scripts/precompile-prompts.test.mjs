// Review of #69: on a Windows checkout with core.autocrlf=true the templates
// are CRLF, and the compiled prompt kept every \r, so the prompt snapshot tests
// failed there (and a deploy built on Windows sent \r\n to the model). The
// compiled template must not depend on how the file was checked out.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compileTemplate } from "./precompile-prompts.mjs";

const template = readFileSync(new URL("../prompts/explanation.njk", import.meta.url), "utf8");
const lf = template.replace(/\r\n?/g, "\n");

test("a CRLF template compiles exactly as its LF original", () => {
  const crlf = lf.replace(/\n/g, "\r\n");
  assert.notEqual(crlf, lf);
  assert.equal(compileTemplate("explanation.njk", crlf), compileTemplate("explanation.njk", lf));
});

test("the compiled template carries no carriage return", () => {
  assert.doesNotMatch(compileTemplate("explanation.njk", lf.replace(/\n/g, "\r\n")), /\\r/);
});
