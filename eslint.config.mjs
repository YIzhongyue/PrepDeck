// ESLint flat config for the whole repository. `npm run lint` at the root lints
// every workspace in one pass; each workspace's own `lint` script runs the same
// config over just its directory.
//
// typescript-eslint parses with the classic TypeScript compiler API, which the
// native TypeScript 7 package no longer ships. npm therefore installs its
// `typescript` peer (6.x) at the root, and each workspace keeps TypeScript 7 in
// its own node_modules for `tsc`. The two never meet: the linter only parses,
// and type-checking stays with `npm run typecheck`.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "**/dist/",
    "**/.wrangler/",
    ".local-state/",
    ".worktrees/",
    "tmp/",
    // Generated.
    "apps/worker/worker-configuration.d.ts",
    "apps/worker/src/prompts/generated/",
    // Vendored Untitled UI source (see CREDITS.md and docs/guides/ui-components.md).
    // It keeps upstream's code and upstream's own eslint-disable directives.
    "apps/web/src/components/base/",
    "apps/web/src/components/application/",
    "apps/web/src/components/foundations/",
    "apps/web/src/utils/",
    "apps/web/src/hooks/use-resize-observer.ts",
  ]),
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // `_`-prefixed names mark parameters and bindings kept for their position.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    // Tests build deliberately malformed fixtures by mutating untyped JSON.
    files: ["**/*.test.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    // Only the two classic hook rules. The rest of the plugin's recommended set
    // checks code for the React Compiler, which PrepDeck does not use.
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
  {
    // Node tooling, tests and the Playwright browser regressions. The browser
    // regressions pass callbacks to page.evaluate(), which run in the page.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
