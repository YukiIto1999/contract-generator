import { defineConfig } from "vite-plus";

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
  test: { include: ["src/**/*.test.ts", "tests/**/*.test.ts"] },
  lint: {
    options: { typeAware: true, typeCheck: false, denyWarnings: true },
    ignorePatterns: ["tests/fixtures/**", "work/**"],
    rules: {
      "typescript/switch-exhaustiveness-check": "error",
      "max-lines": "error",
      "max-lines-per-function": "error",
      "max-depth": "error",
    },
  },
  fmt: { semi: true, singleQuote: false },
});
