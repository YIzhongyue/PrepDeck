// A stand-in browser regression for scripts/browser-regressions.test.mjs.
// FIXTURE_MODE picks how it ends: "pass" closes cleanly, "fail" throws with a
// page open, "hang" never finishes.
import { pathToFileURL } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");

const mode = process.env.FIXTURE_MODE;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setContent("<h1>Fixture page</h1><script>console.log('fixture console marker')</script>");
  console.log("READY");
  if (mode === "fail") throw new Error("fixture failure");
  if (mode === "hang") await new Promise(() => setInterval(() => {}, 1_000));
} finally {
  await browser.close();
}
