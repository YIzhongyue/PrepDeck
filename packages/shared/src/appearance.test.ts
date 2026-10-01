import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { DEFAULT_MASCOT_STYLE, MASCOT_SCENES, MASCOT_STYLES, isMascotStyle, mascotImagePath } from "./appearance.ts";

test("every supported style preserves all eight scenes and resolves to a shipped image", () => {
  assert.equal(DEFAULT_MASCOT_STYLE, "3D-Chibi");
  assert.equal(MASCOT_SCENES.length, 8);
  for (const style of MASCOT_STYLES) {
    assert.ok(isMascotStyle(style));
    for (const scene of MASCOT_SCENES) {
      const path = mascotImagePath(style, scene);
      assert.equal(path, `/mascot/${style}/${scene}.png`);
      assert.ok(existsSync(new URL(`../../../apps/web/public${path}`, import.meta.url)), path);
    }
  }
  for (const invalid of [null, undefined, {}, [], "3d-chibi", "", "../../evil", "https://example.test/image.png"]) {
    assert.equal(isMascotStyle(invalid), false);
  }
});
