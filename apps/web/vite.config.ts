import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Static build output in dist/, served by apps/worker as assets on the same
// Worker/origin as the API (see apps/worker/wrangler.toml [assets]).
export default defineConfig({
  // Tailwind only drives the vendored Untitled UI components in
  // src/components/base (implementation); the rest of the app keeps its own
  // token-based CSS. src/styles/untitled-ui.css explains how the two coexist.
  plugins: [react(), tailwindcss()],
  resolve: {
    // Untitled UI source is vendored unmodified so `npx untitledui add` and
    // `upgrade` keep working, and it imports itself through this alias.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      // During local dev, proxy API and MCP calls to `wrangler dev`, which
      // defaults to port 8787.
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true
      },
      "^/(mcp|admin-mcp)(/|\\?|$)": {
        target: "http://localhost:8787",
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: "dist"
  }
});
