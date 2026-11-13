import { defineConfig } from "vite-plus";
import { selectedSuites } from "./scripts/verification/suites.ts";
import { smallPool } from "./scripts/verification/small-pool.ts";

/** Collection selected by the size runner, or every collection for local feedback */
const suite = process.env.CONTRACT_TEST_SUITE;

/** Small runner: worker without readable paths, test graph served from memory, no snapshot files */
const smallRunner = {
  pool: smallPool,
  fsModuleCache: false,
  server: { deps: { inline: true as const } },
  snapshotEnvironment: "./scripts/verification/small-snapshots.ts",
};

/** Consumer-owned compiler dependency excluded from the emitter bundle */
export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
    rolldownOptions: {
      external: [
        /^@typespec\//,
        /^node:/,
        "@eslint-community/regexpp",
        "re2js",
        "ts-results-es",
        "lossless-json",
      ],
    },
    sourcemap: true,
  },
  test: {
    include: selectedSuites(suite),
    reporters: ["default", "./scripts/verification/reporter.ts"],
    ...(suite === "small" ? smallRunner : {}),
  },
  lint: {
    options: { typeAware: true, typeCheck: false, denyWarnings: true },
    ignorePatterns: [
      "tests/fixtures/contracts/**",
      "tests/fixtures/csharp/**",
      "tests/fixtures/rust/**",
      "tests/fixtures/typescript/**",
      "tests/fixtures/tauri/viewer.ts",
      "work/**",
    ],
    rules: {
      "typescript/switch-exhaustiveness-check": "error",
      "max-lines": "error",
      "max-lines-per-function": "error",
      "max-depth": "error",
    },
  },
  fmt: { semi: true, singleQuote: false },
});
