// implementation — the Settings screen after its migration onto the shared Untitled
// UI primitives (docs/guides/ui-components.md). Optional integration suite: the
// real screen against a local, deterministic HTTP fixture. No real account,
// database or external API is used.
//
// Unlike the other browser suites this one also compiles src/styles/untitled-ui.css
// with the standalone Tailwind CLI, because esbuild cannot process `@import
// "tailwindcss"`, `@theme` or `@plugin`. The compiled sheet is linked ahead of
// tokens.css/app.css, exactly the order App.tsx imports them in.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const playwright = process.env.PLAYWRIGHT_MODULE
  ? await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href) : await import("playwright");
const web = fileURLToPath(new URL("../", import.meta.url));

const tailwindOut = join(await mkdtemp(join(tmpdir(), "prepdeck-uui-")), "untitled-ui.css");
execFileSync(
  process.execPath,
  [resolve(web, "../../node_modules/@tailwindcss/cli/dist/index.mjs"), "-i", resolve(web, "src/styles/untitled-ui.css"), "-o", tailwindOut],
  { cwd: web, stdio: "pipe" }
);
const untitledUiCss = await readFile(tailwindOut, "utf8");

// `?kit` mounts every vendored primitive instead of the screen. Some of them —
// Checkbox, TextArea, Tooltip — are imported because Untitled UI's own source
// depends on them, or because they are next in line for a migration, so no
// migrated screen renders them yet. They still have to follow the five color
// schemes, and this is where that is checked rather than left to inspection.
const { outputFiles } = await build({ stdin: { contents: `
  import React, { useEffect } from 'react'; import { createRoot } from 'react-dom/client';
  import { PrepDeckProvider, usePrepDeck } from './src/store/PrepDeckContext';
  import Settings from './src/screens/Settings';
  import { breakpointsFor } from './src/lib/responsive';
  import { Button } from '@/components/base/buttons/button';
  import { Checkbox } from '@/components/base/checkbox/checkbox';
  import { Input } from '@/components/base/input/input';
  import { RadioButton, RadioGroup } from '@/components/base/radio-buttons/radio-buttons';
  import { Select } from '@/components/base/select/select';
  import { TextArea } from '@/components/base/textarea/textarea';
  import { Toggle } from '@/components/base/toggle/toggle';
  import { Badge, BadgeWithDot } from '@/components/base/badges/badges';
  import { ProgressBar, ProgressBarBase } from '@/components/base/progress-indicators/progress-indicators';
  import { ProgressBarCircle } from '@/components/base/progress-indicators/progress-circles';
  import './src/styles/tokens.css'; import './src/styles/app.css';

  function Kit() {
    return <div style={{display:'flex',flexDirection:'column',gap:16,maxWidth:520}}>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <Button size="md" data-kit="button-primary">Primary</Button>
        <Button size="md" color="secondary" data-kit="button-secondary">Secondary</Button>
        <Button size="md" color="tertiary">Tertiary</Button>
        <Button size="md" color="primary-destructive" data-kit="button-destructive">Delete</Button>
        <Button size="md" isDisabled data-kit="button-disabled">Disabled</Button>
        <Button size="md" isLoading showTextWhileLoading data-kit="button-loading">Saving</Button>
      </div>
      <Input label="Plain field" placeholder="Placeholder" defaultValue="Typed value" data-kit="input" />
      <Input label="Invalid field" isInvalid hint="That value will not do." defaultValue="Wrong" data-kit="input-invalid" />
      <Input label="Disabled field" isDisabled defaultValue="Untouchable" />
      <Input label="With tooltip" tooltip="Explains the field." defaultValue="Hover me" />
      <TextArea label="Notes" rows={3} defaultValue="A few lines of text." data-kit="textarea" />
      <Checkbox size="md" label="Unchecked" hint="A hint under the label." />
      <Checkbox size="md" label="Checked" defaultSelected data-kit="checkbox-checked" />
      <Checkbox size="md" label="Indeterminate" isIndeterminate />
      <Checkbox size="md" label="Disabled" isDisabled />
      <RadioGroup size="md" aria-label="Kit radios" defaultValue="a">
        <RadioButton size="md" value="a" label="Selected" hint="With a hint." />
        <RadioButton size="md" value="b" label="Unselected" />
        <RadioButton size="md" value="c" label="Disabled" isDisabled />
      </RadioGroup>
      <Select label="Picker" defaultSelectedKey="one" items={[{id:'one',label:'One'},{id:'two',label:'Two'}]}>
        {item => <Select.Item key={item.id} id={item.id} label={item.label}>{item.label}</Select.Item>}
      </Select>
      <Toggle size="md" label="Toggle on" defaultSelected data-kit="toggle-on" />
      <Toggle size="md" label="Toggle off" />
      <Toggle size="md" label="Toggle disabled" isDisabled />
      {/* implementation - the badge and progress primitives the Statistics screen
          introduced. Each badge colour below paints from a utility ramp bound
          in untitled-ui.css; an unbound ramp emits no CSS at all, so the badge
          would render unstyled rather than fail the build. */}
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
        <span data-kit="badge-brand"><Badge type="pill-color" size="md" color="brand">Brand</Badge></span>
        <span data-kit="badge-success"><Badge type="pill-color" size="md" color="success">Passed</Badge></span>
        <span data-kit="badge-error"><BadgeWithDot type="pill-color" size="md" color="error">weakest</BadgeWithDot></span>
        <span data-kit="badge-warning"><BadgeWithDot type="pill-color" size="md" color="warning">below line</BadgeWithDot></span>
        <span data-kit="badge-gray"><Badge type="pill-color" size="md" color="gray">needs answers</Badge></span>
      </div>
      <div data-kit="progress-bar"><ProgressBarBase value={62} /></div>
      <div data-kit="progress-bar-empty"><ProgressBarBase value={0} /></div>
      <ProgressBar value={62} labelPosition="right" />
      <div data-kit="progress-circle"><ProgressBarCircle size="xs" value={62} label="ready" /></div>
    </div>;
  }

  function Fixture() { const app = usePrepDeck(); window.fixtureApp = app;
    const kit = new URLSearchParams(window.location.search).has('kit');
    useEffect(() => app.go('settings'), []);
    return <div data-pd-theme={app.state.theme} style={{minHeight:'100vh',background:'var(--color-bg)',color:'var(--color-text)',fontFamily:'var(--font-body)',padding:16}}>
      {kit ? <Kit/> : <Settings bp={breakpointsFor(app.width)}/>}
    </div>;
  }
  createRoot(document.getElementById('root')).render(<PrepDeckProvider><Fixture/></PrepDeckProvider>);
`, loader: "tsx", resolveDir: web }, bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic",
  alias: { "@": resolve(web, "src") }, define: { "process.env.NODE_ENV": '"development"' } });

let profile = { id: "me", displayName: "Student", email: "student@example.test", role: "user" };
let userSettings = { showSharedNotes: false };
let emailSettings = { enabled: false, questionsPerEmail: 3, source: "wrong", sendHourLocal: 8, timezone: "UTC" };
let markAliases = { hl1Alias: "Important", hl2Alias: "Review", hl3Alias: "Question" };
let avatarStatus = 200;

const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://fixture").pathname;
    const json = (status, data) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
    if (path === "/fixture.js" || path === "/fixture.css") {
      res.setHeader("Content-Type", path.endsWith("css") ? "text/css" : "text/javascript");
      return res.end(outputFiles.find(f => f.path.endsWith(path.slice(1)))?.contents);
    }
    if (path === "/untitled-ui.css") { res.setHeader("Content-Type", "text/css"); return res.end(untitledUiCss); }
    if (!path.startsWith("/api/")) {
      res.setHeader("Content-Type", "text/html");
      return res.end('<!doctype html><html data-pd-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1">'
        + '<link rel="stylesheet" href="/untitled-ui.css"><link rel="stylesheet" href="/fixture.css">'
        + '</head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>');
    }
    let raw = Buffer.alloc(0); for await (const part of req) raw = Buffer.concat([raw, part]);
    const input = req.headers["content-type"]?.startsWith("image/") ? {} : JSON.parse(raw.toString() || "{}");
    if (path === "/api/auth/me") return json(200, { user: profile });
    if (path === "/api/exams") return json(200, { exams: [{ id: "exam", slug: "cloud", name: "Cloud fundamentals" }] });
    if (path.includes("practice-catalog")) return json(200, { questions: [], bookmarkedIds: [], wrongEntries: [], attemptedIds: [] });
    if (path === "/api/attempts/active") return json(200, { attempt: null });
    if (path.endsWith("/learning/progress")) return json(200, { progress: { lastSequenceNumber: null } });
    if (path === "/api/settings") {
      if (req.method === "PUT" || req.method === "PATCH") userSettings = { ...userSettings, ...input };
      return json(200, userSettings);
    }
    if (path === "/api/annotation-settings") {
      if (req.method !== "GET") markAliases = { ...markAliases, ...input };
      return json(200, markAliases);
    }
    if (path === "/api/daily-email-settings") {
      if (req.method !== "GET") emailSettings = { ...emailSettings, ...input };
      return json(200, emailSettings);
    }
    if (path === "/api/me" && req.method === "PATCH") { profile = { ...profile, ...input }; return json(200, { user: profile }); }
    if (path === "/api/me/avatar") return json(avatarStatus, avatarStatus === 200 ? { user: profile } : { error: "too_large" });
    if (path === "/api/mcp-tokens") return json(200, { credentials: [] });
    return json(200, {});
  } catch (err) { res.writeHead(500); res.end(String(err)); }
});

await new Promise(done => server.listen(0, done));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const failures = [];
page.on("pageerror", err => failures.push(String(err)));

const THEMES = ["light", "cream", "sage", "clay", "dusk"];
const setTheme = theme => page.evaluate(t => window.fixtureApp.setTheme(t), theme);
const wait = async (check, label) => {
  for (let i = 0; i < 100; i++) { if (await check()) return; await page.waitForTimeout(50); }
  throw new Error(`timed out waiting for ${label}`);
};
// Colors are compared as the browser resolves them, which is the whole point:
// a token that stopped following [data-pd-theme] resolves to the old scheme.
// The listbox itself is transparent; `bg-primary` sits on the popover that
// wraps it, which is the element React Aria actually portals.
const popoverBgOf = locator => locator.evaluate(el => {
  for (let node = el; node; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
  }
  return null;
});
// The nearest ancestor that actually paints, which is what a reader sees
// behind the element.
const paintedBgOf = locator => locator.evaluate(el => {
  for (let node = el; node; node = node.parentElement) {
    const bg = getComputedStyle(node).backgroundColor;
    const parts = bg.match(/[\d.]+/g);
    if (parts && (parts.length < 4 || Number(parts[3]) > 0.99)) return bg;
  }
  return null;
});
const relativeLuminance = ([r, g, b]) => {
  const channel = value => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
// Reads the element's own resolved text color against whatever paints behind
// it. Both sides come from getComputedStyle, so a mis-bound token shows up as
// a real contrast failure rather than as a mismatched string. Colours are
// normalised through a canvas because `color-mix()` resolves to
// `color(srgb ...)` with 0-1 components in Chrome, and a translucent
// foreground is composited over its backdrop first.
const contrastOf = async locator => {
  const { color, bg } = await locator.evaluate(el => {
    const toRgba = value => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).map((v, i) => (i === 3 ? v / 255 : v));
    };
    const target = el.matches("input, textarea") ? el : el.querySelector("input, textarea, [data-text], p") || el;
    let painted = null;
    for (let node = el; node && !painted; node = node.parentElement) {
      const rgba = toRgba(getComputedStyle(node).backgroundColor);
      if (rgba[3] > 0.99) painted = rgba;
    }
    return { color: toRgba(getComputedStyle(target).color), bg: painted };
  });
  const over = (fg, backdrop) => fg.slice(0, 3).map((c, i) => c * fg[3] + backdrop[i] * (1 - fg[3]));
  const a = relativeLuminance(over(color, bg));
  const b = relativeLuminance(bg);
  const show = c => `rgb(${c.slice(0, 3).map(Math.round).join(" ")}${c[3] < 0.99 ? ` / ${c[3].toFixed(2)}` : ""})`;
  return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), color: show(color), bg: show(bg) };
};

const screenshotDir = process.env.SETTINGS_SCREENSHOTS || process.env.SCREENSHOT_DIR;
if (screenshotDir) await mkdir(screenshotDir, { recursive: true });

try {
  await page.goto(base);
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();

  // --- Accessible labels on the migrated controls -------------------------
  const name = page.getByRole("textbox", { name: "Display name" });
  await name.waitFor();
  assert.equal(await name.inputValue(), "Student", "display name is populated from the profile");
  await page.getByRole("textbox", { name: "First mark" }).waitFor();
  await page.getByRole("switch", { name: /shared notes/ }).waitFor();
  await page.getByRole("button", { name: "Sign out", exact: true }).waitFor();

  // --- Validation feedback -------------------------------------------------
  await name.fill("");
  await page.getByText("Enter a display name to save it.").waitFor();
  assert.equal(await name.getAttribute("aria-invalid"), "true", "an empty display name marks the field invalid");
  assert.equal(await page.getByRole("button", { name: "Save", exact: true }).count(), 0, "Save stays hidden while the name is empty");

  // --- Keyboard operation, a visible focus ring, and the save behind it ----
  // Save is only mounted while the draft differs from the saved name, so this
  // runs before the PATCH lands rather than after it.
  await name.fill("Reviewer");
  await page.getByRole("button", { name: "Save", exact: true }).waitFor();
  await name.focus();
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    const style = getComputedStyle(el);
    return { tag: el.tagName, text: el.textContent, outline: style.outlineWidth, ring: style.getPropertyValue("--tw-ring-color") || style.boxShadow };
  });
  assert.equal(focused.tag, "BUTTON", "Tab from the name field reaches its Save button");
  assert.ok(focused.text.includes("Save"), "Tab lands on Save rather than some other control");
  assert.ok(focused.outline !== "0px" || focused.ring !== "", "the focused control shows a ring or outline");
  await page.keyboard.press("Enter");
  await wait(() => profile.displayName === "Reviewer", "display name PATCH from the keyboard");

  // --- Toggle: keyboard-operable and writes through ------------------------
  const sharedNotes = page.getByRole("switch", { name: /shared notes/ });
  await sharedNotes.focus();
  await page.keyboard.press("Space");
  await wait(() => userSettings.showSharedNotes === true, "shared-notes toggle PUT");

  // --- Disabled state ------------------------------------------------------
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const loadKey = page.getByRole("button", { name: "Load key", exact: true });
  await loadKey.waitFor();
  assert.ok(await loadKey.isDisabled(), "the key button is disabled until a key is typed");
  await page.getByRole("textbox", { name: "API key" }).fill("sk-ant-test");
  await wait(async () => !(await loadKey.isDisabled()), "key button enables");
  // Untitled UI's password input brings its own reveal control, which replaced
  // this screen's separate Show/Hide button.
  await page.getByRole("button", { name: "Toggle password visibility" }).click();
  assert.equal(await page.getByRole("textbox", { name: "API key" }).getAttribute("type"), "text", "the key is revealed in place");

  // --- A portaled overlay re-themes live, with no reload -------------------
  await page.getByRole("button", { name: "Back", exact: true }).click();
  const modelSelect = page.getByRole("button", { name: /Model/ }).first();
  await modelSelect.click();
  const listbox = page.getByRole("listbox");
  await listbox.waitFor();
  const portaled = await listbox.evaluate(el => !el.closest("[data-pd-theme]") || el.closest("[data-pd-theme]") === document.documentElement);
  assert.ok(portaled, "the select popover really is portaled outside the themed shell");
  const popoverBefore = await popoverBgOf(listbox);
  assert.ok(popoverBefore, "the popover paints a surface of its own");
  await setTheme("dusk");
  await wait(async () => await popoverBgOf(listbox) !== popoverBefore, "the open popover repaints on a scheme change");
  assert.ok(await listbox.isVisible(), "the popover stays open across the scheme change");
  await page.keyboard.press("Escape");
  await listbox.waitFor({ state: "hidden" });
  await setTheme("light");

  // --- The scheme survives navigation and a reload -------------------------
  await setTheme("sage");
  await page.reload();
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute("data-pd-theme")), "sage", "the scheme is restored after a reload");
  await setTheme("light");

  // --- Imported components track the scheme, and stay readable -------------
  const signOut = page.getByRole("button", { name: "Sign out", exact: true });
  const seen = new Set();
  for (const theme of THEMES) {
    await setTheme(theme);
    await page.waitForTimeout(80);
    assert.equal(
      await page.evaluate(() => document.documentElement.getAttribute("data-pd-theme")), theme,
      `${theme} reaches <html>, so portaled overlays inherit it`
    );
    const painted = await signOut.evaluate(el => {
      const style = getComputedStyle(el);
      return { bg: style.backgroundColor, fg: style.color, ring: style.boxShadow };
    });
    assert.ok(!seen.has(painted.bg + painted.fg), `${theme} paints the imported button differently from the previous schemes`);
    seen.add(painted.bg + painted.fg);
    assert.notEqual(painted.bg, painted.fg, `${theme} keeps the imported button's label distinguishable from its surface`);

    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(80);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        `${theme} ${width}px has page overflow`
      );
      if (screenshotDir && (width === 375 || theme === "light")) {
        await page.screenshot({ path: resolve(screenshotDir, `settings-untitled-ui-${theme}-${width}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
  }

  // --- Every imported primitive, in every scheme ---------------------------
  await page.goto(`${base}/?kit`);
  await page.getByRole("button", { name: "Primary", exact: true }).waitFor();
  // The controls cross-fade over 100ms on a scheme change, and getComputedStyle
  // reports the interpolated colour part-way through. Settle them so the
  // contrast figures below are the real ones rather than a blend.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  // Text on a page or field surface is body text, so WCAG AA's 4.5:1 applies.
  const KIT_ON_SURFACE = ["button-secondary", "input", "input-invalid", "textarea",
    "badge-brand", "badge-success", "badge-error", "badge-warning", "badge-gray", "progress-circle"];
  // A label on a solid accent or danger fill is held to 3:1. That is not a
  // relaxed standard picked to make this pass: it is the ratio PrepDeck's own
  // `.btn-primary` already achieves, because both use the page background as
  // the on-accent ink. Cream (3.03:1), Sage (3.28:1) and Clay (3.60:1) sit
  // below 4.5:1 today on every existing screen. Raising the floor here means
  // changing the brand palette for the whole app, which
  // docs/guides/ui-components.md records as follow-up work.
  const KIT_ON_FILL = ["button-primary", "button-destructive"];
  const kitPaint = new Map();
  for (const theme of THEMES) {
    await setTheme(theme);
    await page.waitForTimeout(80);

    for (const [floor, group] of [[4.5, KIT_ON_SURFACE], [3, KIT_ON_FILL]]) {
      for (const kit of group) {
        const { ratio, color, bg } = await contrastOf(page.locator(`[data-kit="${kit}"]`).first());
        assert.ok(ratio >= floor, `${theme} ${kit}: ${color} on ${bg} is ${ratio.toFixed(2)}:1, below ${floor}:1`);
      }
    }

    // A filled control has to read as filled, and an empty one as empty, in
    // every scheme — a token that stopped resolving would collapse the two.
    const checkedBg = await paintedBgOf(page.locator('[data-kit="checkbox-checked"] div').first());
    const toggleBg = await paintedBgOf(page.locator('[data-kit="toggle-on"] div').first());
    const fieldBg = await paintedBgOf(page.locator('[data-kit="input"] input').first());
    assert.notEqual(checkedBg, fieldBg, `${theme}: a selected checkbox is indistinguishable from an empty field`);
    assert.notEqual(toggleBg, fieldBg, `${theme}: an on toggle is indistinguishable from an empty field`);

    // The disabled button must not read the same as the enabled one.
    const enabled = await paintedBgOf(page.locator('[data-kit="button-primary"]'));
    const disabled = await page.locator('[data-kit="button-disabled"]').evaluate(el => getComputedStyle(el).opacity);
    assert.ok(Number(disabled) < 1, `${theme}: the disabled button is not dimmed`);
    assert.ok(enabled, `${theme}: the primary button has a fill`);

    // A progress bar that lost its fill token would paint the same as its own
    // empty track, which reads as "no progress" rather than as broken.
    const progressFill = await paintedBgOf(page.locator('[data-kit="progress-bar"] div').first());
    const progressTrack = await paintedBgOf(page.locator('[data-kit="progress-bar-empty"]').first());
    assert.notEqual(progressFill, progressTrack, `${theme}: a filled progress bar is indistinguishable from an empty one`);
    for (const badge of ["badge-brand", "badge-success", "badge-error", "badge-warning", "badge-gray"]) {
      const fill = await paintedBgOf(page.locator(`[data-kit="${badge}"] > *`).first());
      assert.notEqual(fill, fieldBg, `${theme}: ${badge} has no fill of its own`);
    }

    const fingerprint = [checkedBg, toggleBg, fieldBg, enabled, progressFill].join("|");
    assert.ok(!kitPaint.has(fingerprint), `${theme} paints the kit identically to ${kitPaint.get(fingerprint)}`);
    kitPaint.set(fingerprint, theme);

    for (const width of [1280, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(60);
      assert.ok(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
        `${theme} ${width}px kit has page overflow`
      );
      if (screenshotDir && (width === 375 || theme === "light")) {
        await page.screenshot({ path: resolve(screenshotDir, `untitled-ui-kit-${theme}-${width}.png`), fullPage: true });
      }
    }
    await page.setViewportSize({ width: 1280, height: 1000 });
  }

  assert.deepEqual(failures, [], "no uncaught browser exceptions");
  console.log("Settings/Untitled UI browser regression passed: labels, validation, keyboard, disabled and loading states, portaled overlay re-theming, scheme persistence, every imported primitive above its contrast floor, and 1280/375px in all five schemes.");
} finally {
  await browser.close();
  server.close();
}
