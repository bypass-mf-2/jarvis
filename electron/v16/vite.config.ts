/**
 * Vite config for the v16 Electron renderer.
 *
 * Builds the React-based overlay from `renderer/` into a static bundle
 * that Electron loads via file:// in production OR the dev server via
 * http://localhost:5173 in development.
 *
 * Main + preload are NOT bundled by Vite. They're plain TypeScript that
 * Electron runs directly (we rely on tsx/ts-node for dev and a simple
 * tsc pass for production). If you need full bundling of main too, swap
 * in electron-vite — but for a single-window app this keeps the toolchain
 * simple.
 *
 * Path aliases mirror the root tsconfig so the renderer can import from
 * `client/src/v16/` via `@/v16/...` — same ergonomics as v15 client code.
 */

import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import * as path from "path";

// Vite version drift: the root monorepo uses Vite 7, v16 uses Vite 6, so the
// Plugin types from @tailwindcss/vite (linked against root) don't structurally
// match v16's. Runtime is fine — cast through to satisfy the local typer.
const tailwindPlugin = tailwindcss() as unknown as PluginOption;

export default defineConfig({
  root: path.resolve(__dirname, "renderer"),
  base: "./", // relative paths so file:// loading works in production
  plugins: [react(), tailwindPlugin],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "../../client/src"),
      "@shared": path.resolve(__dirname, "../../shared"),
    },
  },
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    // Electron renderer targets Chromium, can use modern output.
    target: "chrome124",
    rollupOptions: {
      input: path.resolve(__dirname, "renderer/index.html"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
