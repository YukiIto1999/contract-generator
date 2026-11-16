import { expect, test } from "vite-plus/test";
import { releaseSummary } from "./release-summary.ts";

/** Commit that the summary names */
const commit = "8ab42f0a1b2c3d4e5f60718293a4b5c6d7e8f901";

/** Receipt of a check that runs no tests */
const staticReceipt = (check: string): unknown => ({
  version: 1,
  check,
  result: "passed",
  tests: null,
  environment: { node: "v24.21.0", tools: {} },
});

/**
 * Receipt of a test collection
 * @param check - Collection name
 * @param tests - Passed test identities
 * @param modules - Completed modules
 * @param tools - Tool identities of the environment
 * @returns Receipt as `verify:push` stores it
 */
function collectionReceipt(
  check: string,
  tests: number,
  modules: number,
  tools: Readonly<Record<string, string>> = {},
): unknown {
  return {
    version: 1,
    check,
    result: "passed",
    tests: {
      modules: Array.from({ length: modules }, (_, index) => `${check}/${index}.test.ts`),
      ids: Array.from({ length: tests }, (_, index) => `${check}-${index}`),
    },
    environment: { node: "v24.21.0", tools },
  };
}

/** Receipts of a complete passing `verify:push` */
function complete(): Record<string, unknown> {
  return {
    build: staticReceipt("build"),
    typecheck: staticReceipt("typecheck"),
    check: staticReceipt("check"),
    small: collectionReceipt("small", 120, 25),
    profile: collectionReceipt("profile", 40, 20),
    arch: collectionReceipt("arch", 3, 1),
    local: collectionReceipt("local", 30, 9),
    typescript: collectionReceipt("typescript", 12, 1),
    csharp: collectionReceipt("csharp", 210, 25, {
      dotnet: ".NET SDK:\n Version:           10.0.201\n Commit:            4d3023de60\n",
    }),
    rust: collectionReceipt("rust", 80, 8, {
      rustc: "rustc 1.94.0 (4a4ef493e 2026-03-02)\nbinary: rustc\nrelease: 1.94.0\n",
      cargo: "cargo 1.94.0 (85eff7c80 2026-01-15)\nrelease: 1.94.0\n",
    }),
    tauri: collectionReceipt("tauri", 5, 1, { webkit: "3.24.43\n2.50.1\n3.6.5\n" }),
  };
}

test("the summary names the commit, the toolchain and the count of every collection", () => {
  expect(releaseSummary(commit, complete())).toBe(
    [
      "verify:push summary",
      `commit: ${commit}`,
      "node: v24.21.0",
      "dotnet SDK: 10.0.201",
      "rustc: 1.94.0",
      "cargo: 1.94.0",
      "gtk+-3.0: 3.24.43",
      "webkit2gtk-4.1: 2.50.1",
      "libsoup-3.0: 3.6.5",
      "build: passed",
      "typecheck: passed",
      "check: passed",
      "small: 120 tests in 25 modules",
      "profile: 40 tests in 20 modules",
      "arch: 3 tests in 1 module",
      "local: 30 tests in 9 modules",
      "typescript: 12 tests in 1 module",
      "csharp: 210 tests in 25 modules",
      "rust: 80 tests in 8 modules",
      "tauri: 5 tests in 1 module",
      "",
    ].join("\n"),
  );
});

test("a check without a receipt stops the summary and is named", () => {
  const receipts = complete();
  delete receipts.csharp;
  expect(() => releaseSummary(commit, receipts)).toThrow(/csharp/);
});

test("a receipt of another check or of a failure is not accepted for a check", () => {
  expect(() =>
    releaseSummary(commit, { ...complete(), rust: collectionReceipt("arch", 1, 1) }),
  ).toThrow(/rust/);
  expect(() => releaseSummary(commit, { ...complete(), small: { result: "failed" } })).toThrow(
    /small/,
  );
});

test("a collection without a passed test is not summarized as a success", () => {
  expect(() =>
    releaseSummary(commit, { ...complete(), small: collectionReceipt("small", 0, 1) }),
  ).toThrow(/small/);
});
