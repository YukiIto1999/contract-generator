import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test } from "vite-plus/test";

/** Checkout owning the actual published emitter and desktop fixture */
const repository = fileURLToPath(new URL("../../../", import.meta.url));

test("connects a real Wry webview generated consumer to the Rust provider and drains shutdown", () => {
  const result = spawnSync(process.execPath, ["tests/fixtures/tauri/run.ts", "smoke"], {
    cwd: repository,
    encoding: "utf8",
    timeout: 900_000,
    maxBuffer: 1 << 28,
  });
  expect({
    status: result.status,
    signal: result.signal,
    error: result.error?.message,
    stderr: result.status === 0 ? "" : result.stderr,
    stdout: result.status === 0 ? "" : result.stdout,
  }).toEqual({ status: 0, signal: null, error: undefined, stderr: "", stdout: "" });
  const events: unknown[] = result.stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line) => JSON.parse(line));
  expect(events).toContainEqual({
    event: "webview-result",
    checks: [
      "not-ready",
      "provider-default",
      "explicit-input",
      "declared-rejection",
      "invalid-boundary",
      "unknown-command",
      "state-unchanged",
      "in-flight-cancelled",
      "stopped",
    ],
    failure: null,
    passed: true,
    total: 5,
    writes: 2,
    entered: 4,
    active: 0,
    cancelled: 1,
  });
  expect(events).toContainEqual({ event: "host-exit", passed: true });
}, 900_000);
