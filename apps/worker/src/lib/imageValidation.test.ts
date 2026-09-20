import assert from "node:assert/strict";
import test from "node:test";
import { hasValidImageContent } from "./imageValidation.ts";

const buffer = (...bytes: number[]) => Uint8Array.from(bytes).buffer as ArrayBuffer;

function png(width = 1, height = 1, trailer: number[] = []) {
  return buffer(
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    width >>> 24, width >>> 16, width >>> 8, width,
    height >>> 24, height >>> 16, height >>> 8, height,
    8, 6, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0,
    ...trailer,
  );
}

test("accepts a structurally valid raster with matching MIME", () => {
  assert.equal(hasValidImageContent(png(), "image/png"), true);
});

test("rejects malicious SVG even when declared as an allowed MIME", () => {
  const svg = new TextEncoder().encode('<svg onload="alert(1)"><foreignObject/></svg>').buffer;
  assert.equal(hasValidImageContent(svg, "image/png"), false);
});

test("rejects forged MIME types", () => {
  assert.equal(hasValidImageContent(png(), "image/jpeg"), false);
});

test("rejects multi-format polyglots and trailing active content", () => {
  const payload = [...new TextEncoder().encode("<svg><script>alert(1)</script></svg>")];
  assert.equal(hasValidImageContent(png(1, 1, payload), "image/png"), false);
});

test("rejects small compressed images with decompression-bomb dimensions", () => {
  assert.equal(hasValidImageContent(png(100_000, 100_000), "image/png"), false);
});
