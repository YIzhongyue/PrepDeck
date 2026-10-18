// Loads TypeScript source into a Node test: esbuild bundles it, and the bundle
// is imported from a file in this process's own temporary directory. Shared by
// the apps/worker, apps/web and root tests, which used to each carry their own
// copy of this build-and-import step.
//
// A file URL rather than a data: URL keeps one code path for every platform:
// a Node or workerd bundle needs `createRequire(import.meta.url)` for the
// CommonJS packages it inlines, and that needs a real file location.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const REQUIRE_BANNER = 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);';

// - "neutral": the default, for Worker and web modules that need no host APIs.
// - "browser": resolves packages' browser builds.
// - "node": may use Node built-ins and inline CommonJS packages.
// - "workerd": the Worker's export conditions (the MCP SDK, for one), on Node.
const PLATFORMS = {
  neutral: { platform: "neutral", mainFields: ["module", "main"] },
  browser: { platform: "browser", mainFields: ["browser", "module", "main"] },
  node: { platform: "node", banner: { js: REQUIRE_BANNER } },
  workerd: { platform: "node", conditions: ["workerd"], banner: { js: REQUIRE_BANNER } },
};

let directory;
let sequence = 0;

function outputDirectory() {
  if (!directory) {
    directory = mkdtempSync(join(tmpdir(), "prepdeck-test-bundle-"));
    process.on("exit", () => rmSync(directory, { recursive: true, force: true }));
  }
  return directory;
}

function entryOptions(entry) {
  if (entry instanceof URL) return { entryPoints: [fileURLToPath(entry)] };
  if (Array.isArray(entry)) {
    // Several modules in one bundle share one copy of their dependencies,
    // so they see the same module state, as they would in the Worker.
    const contents = entry.map(url => `export * from ${JSON.stringify(fileURLToPath(url))};`).join("\n");
    return { stdin: { contents, resolveDir: fileURLToPath(new URL(".", entry[0])), loader: "ts" } };
  }
  const { contents, resolveDir, loader = "ts" } = entry;
  return { stdin: { contents, resolveDir: fileURLToPath(resolveDir), loader } };
}

/**
 * Bundles TypeScript and imports the result.
 *
 * @param {URL | URL[] | { contents: string, resolveDir: URL, loader?: "ts" | "tsx" }} entry
 *   One module, several modules re-exported from one bundle, or literal entry
 *   source resolved from `resolveDir`.
 * @param {{ platform?: "neutral" | "browser" | "node" | "workerd" } & import("esbuild").BuildOptions} [options]
 *   Further esbuild options override the platform's own.
 */
export async function importTs(entry, { platform = "neutral", ...overrides } = {}) {
  const preset = PLATFORMS[platform];
  if (!preset) throw new Error(`Unknown bundle platform ${platform}; expected ${Object.keys(PLATFORMS).join(", ")}`);
  // An output path lets a component's CSS import build alongside it.
  const file = join(outputDirectory(), `bundle-${++sequence}.mjs`);
  const { outputFiles } = await build({
    ...entryOptions(entry),
    bundle: true,
    write: false,
    format: "esm",
    outfile: file,
    ...preset,
    ...overrides,
  });
  writeFileSync(file, outputFiles.find(output => output.path === file).text);
  return import(pathToFileURL(file).href);
}
