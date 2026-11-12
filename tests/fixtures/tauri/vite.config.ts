import { defineConfig } from "vite-plus";

/** Materialized viewer root supplied by the fixture runner */
const root = process.env.CONTRACT_GENERATOR_TAURI_ROOT;
if (root === undefined) throw new Error("Run the Tauri fixture through run.ts");

/** Real webview asset bundle without an external development server */
export default defineConfig({
  root: `${root}/frontend`,
  build: { target: "esnext", outDir: "../dist", emptyOutDir: true },
});
