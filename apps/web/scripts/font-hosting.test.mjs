// Issue #44: the brand typefaces were @imported from Google Fonts, which the
// production CSP refuses, so every page outside Vite dev fell back to
// system-ui. They are self-hosted now; these keep it that way cheaply. The
// Worker-served check (fonts actually loaded, no CSP errors) is in
// scripts/local-smoke.mjs --browser.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../src/", import.meta.url));
const cssFiles = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? cssFiles(path) : name.endsWith(".css") ? [path] : [];
});

test("no stylesheet imports anything from another origin", () => {
  for (const file of cssFiles(src)) {
    const css = readFileSync(file, "utf8");
    assert.doesNotMatch(css, /@import\s+(url\()?\s*["']?(https?:)?\/\//i, `${file} imports a remote stylesheet`);
    assert.doesNotMatch(css, /fonts\.(googleapis|gstatic)\.com/i, file);
  }
});

test("the brand faces are self-hosted and imported by the app", () => {
  const fonts = readFileSync(join(src, "styles/fonts.css"), "utf8");
  for (const face of ["@fontsource/figtree/400.css", "@fontsource/figtree/600.css", "@fontsource/figtree/700.css", "@fontsource/caprasimo/400.css", "@fontsource/jetbrains-mono/400.css"]) {
    assert.ok(fonts.includes(`@import "${face}"`), face);
  }
  assert.match(readFileSync(join(src, "App.tsx"), "utf8"), /import "\.\/styles\/fonts\.css";/);
});

test("the CSP still allows styles and fonts from 'self' only", () => {
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8");
  const directive = name => headers.match(new RegExp(`${name} ([^;]+)`))?.[1].trim();
  assert.equal(directive("style-src"), "'self' 'unsafe-inline'");
  assert.equal(directive("font-src"), "'self' data:");
});
