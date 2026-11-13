import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, onTestFinished, test } from "vite-plus/test";
import { verificationEnvironment, probe } from "../../../scripts/verification/environment.ts";
import { dependencyFiles, digestFiles } from "../../../scripts/verification/inputs.ts";
import { runCommand } from "../../../scripts/verification/process.ts";
import { sourceClosure } from "../../../scripts/verification/source-inputs.ts";
import {
  attemptCheck,
  readReceipt,
  saveReceipt,
  type Receipt,
} from "../../../scripts/verification/evidence.ts";

/** Isolated input directory for a verifier scenario
 * @returns Empty test-owned directory
 */
async function sandbox(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "contract-verifier-"));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("dependency source edits invalidate a consumer but unrelated files do not", async () => {
  const root = await sandbox();
  const entry = join(root, "entry.ts");
  const dependency = join(root, "dependency.ts");
  await writeFile(entry, 'import { value } from "./dependency.js"; export { value };');
  await writeFile(dependency, "export const value = 1;");
  const before = digestFiles(sourceClosure([entry]));
  await writeFile(join(root, "unrelated.md"), "reader-only change");
  expect(digestFiles(sourceClosure([entry]))).toBe(before);
  await writeFile(dependency, "export const value = 2;");
  expect(digestFiles(sourceClosure([entry]))).not.toBe(before);
});

test("Vitest module-cache outputs do not change installed dependency identity", async () => {
  const modules = join(await sandbox(), "node_modules");
  const packageRoot = join(modules, "example");
  const cache = join(modules, ".vitest-cache");
  const packageSource = join(packageRoot, ".vitest-cache");
  await mkdir(packageSource, { recursive: true });
  await writeFile(join(packageRoot, "index.js"), "export const value = 1;");
  await writeFile(join(packageSource, "source.js"), "export const value = 1;");
  const before = digestFiles(dependencyFiles(modules));
  await mkdir(cache);
  await writeFile(join(cache, "module"), "first transformed output");
  expect(digestFiles(dependencyFiles(modules))).toBe(before);
  await writeFile(join(cache, "module"), "changed transformed output");
  expect(digestFiles(dependencyFiles(modules))).toBe(before);
  await writeFile(join(packageRoot, "index.js"), "export const value = 2;");
  const changed = digestFiles(dependencyFiles(modules));
  expect(changed).not.toBe(before);
  await writeFile(join(packageSource, "source.js"), "export const value = 2;");
  expect(digestFiles(dependencyFiles(modules))).not.toBe(changed);
});

test("a missing local source input fails instead of reusing earlier evidence", async () => {
  const root = await sandbox();
  const entry = join(root, "entry.ts");
  await writeFile(entry, 'import "./missing.js";');
  expect(() => sourceClosure([entry])).toThrow("Unresolved module input");
});

/** Earlier successful Small receipt that a new attempt must not leave behind */
const earlier: Receipt = {
  version: 1,
  check: "small",
  key: "earlier",
  result: "passed",
  command: ["node"],
  inputs: ["entry.ts"],
  environment: {},
  dependencies: "deps",
  completedAt: "2026-11-12T00:00:00Z",
  seconds: 1,
  tests: { ids: ["native-id"], modules: ["entry.test.ts"] },
  output: null,
};

// Real OS process cancellation precludes fake-clock substitution
test.each([
  ["failed", [process.execPath, "-e", "process.exitCode = 7"], 5_000, "status 7"],
  [
    "interrupted",
    [process.execPath, "-e", "setInterval(() => {}, 1000)"],
    50,
    "interrupted or exceeded",
  ],
])(
  "a %s attempt removes earlier pass evidence and publishes none",
  async (_state, command, milliseconds, failure) => {
    const root = await sandbox();
    saveReceipt(root, earlier);
    const attempt = attemptCheck(root, "small", async () => {
      const outcome = await runCommand(command, verificationEnvironment(), milliseconds);
      if (outcome.status !== 0) throw new Error(`small failed: status ${outcome.status}`);
      return { ...earlier, key: "current" };
    });
    await expect(attempt).rejects.toThrow(failure);
    expect(readReceipt(root, "small")).toBeUndefined();
  },
  10_000,
);

test("a completed attempt publishes exactly its current pass evidence", async () => {
  const root = await sandbox();
  saveReceipt(root, earlier);
  await attemptCheck(root, "small", async () => ({ ...earlier, key: "current" }));
  expect(readReceipt(root, "small")).toMatchObject({
    check: "small",
    key: "current",
    result: "passed",
  });
});

test("an expired whole-tier budget starts no child and creates no evidence", async () => {
  const root = await sandbox();
  const marker = join(root, "started");
  await expect(
    runCommand(
      [
        process.execPath,
        "-e",
        'require("node:fs").writeFileSync(process.argv[1], "started")',
        marker,
      ],
      verificationEnvironment(),
      0,
    ),
  ).rejects.toThrow("budget exhausted");
  await expect(readFile(marker)).rejects.toHaveProperty("code", "ENOENT");
});

test("a one-run ceiling cancels and reaps the active child instead of returning PASS", async () => {
  // Real OS process cancellation precludes fake-clock substitution
  await expect(
    runCommand(
      [process.execPath, "-e", "setInterval(() => {}, 1000)"],
      verificationEnvironment(),
      50,
    ),
  ).rejects.toThrow("interrupted or exceeded");
}, 10_000);

test("missing required native tooling is a failure rather than skip evidence", () => {
  expect(() =>
    probe(["contract-generator-nonexistent-required-tool", "--version"], verificationEnvironment()),
  ).toThrow("Required environment unavailable");
});

/** Parent command that exits after its owned descendant reports readiness
 * @param source - Descendant program with a real readiness message
 * @param marker - Test-owned observation file
 * @returns Command leaving the descendant in the parent's process group
 */
function orphanCommand(source: string, marker: string): string[] {
  const parent = `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", process.argv[1], process.argv[2]],
      { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    child.once("message", () => process.exit(0));
  `;
  return [process.execPath, "-e", parent, source, marker];
}

test("normal group shutdown waits for finite descendant work after its parent closes", async () => {
  // Real descendant lifetime after parent exit cannot be driven by the test process's fake clock
  const marker = join(await sandbox(), "completed");
  const source = `
    const { writeFileSync } = require("node:fs");
    process.once("disconnect", () => {
      setTimeout(() => writeFileSync(process.argv[1], "completed"), 100);
    });
    process.send("ready");
  `;
  const result = await runCommand(orphanCommand(source, marker), verificationEnvironment(), 5_000);
  expect(result.status).toBe(0);
  expect(await readFile(marker, "utf8")).toBe("completed");
});

test("a persistent orphan prevents pass evidence and is killed even when it ignores SIGTERM", async () => {
  // Real signal handling and escalation require a live operating-system process
  const marker = join(await sandbox(), "orphan-pid");
  const source = `
    require("node:fs").writeFileSync(process.argv[1], String(process.pid));
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
    process.send("ready");
  `;
  onTestFinished(async () => {
    const pid = Number(await readFile(marker, "utf8"));
    try {
      const command = await readFile(`/proc/${pid}/cmdline`, "utf8");
      if (command.split("\0").includes(marker)) process.kill(pid, "SIGKILL");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        (error.code !== "ESRCH" && error.code !== "ENOENT")
      )
        throw error;
    }
  });
  await expect(
    runCommand(orphanCommand(source, marker), verificationEnvironment(), 10_000),
  ).rejects.toThrow("left running descendants");
  const pid = await readFile(marker, "utf8");
  await readFile(`/proc/${pid}/stat`, "utf8").then(
    (stat) => expect(/\) [ZX] /.test(stat)).toBe(true),
    (error: unknown) => expect(error).toHaveProperty("code", "ENOENT"),
  );
}, 15_000);
