import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { materialize, pinnedCrates, type Checkout } from "./materialize.ts";
import { run, type Execution } from "./process.ts";

/** Repository owning the built emitter and installed JavaScript dependencies */
const repository = resolve(import.meta.dirname, "../../..");
/** Literal fixture inputs shared by headless and visual execution */
const fixture = dirname(fileURLToPath(import.meta.url));
/** Supported invocation mode without an implicit network-enabled run */
const mode = process.argv[2];
assert.ok(
  mode === "prepare" || mode === "smoke" || mode === "open",
  "usage: node tests/fixtures/tauri/run.ts prepare [--create-lock]|smoke|open",
);
assert.equal(
  process.platform,
  "linux",
  "This acceptance fixture supports Linux with GTK3/WebKitGTK 4.1",
);
/** Explicit one-time adoption of a new transitive fixture resolution */
const createLock = mode === "prepare" && process.argv[3] === "--create-lock";
/** Tracked complete Cargo resolution of the fixture host */
const lock = join(fixture, "Cargo.lock");
/** Finite safety bound for the headless application after its build */
const smokeLimit = 60_000;
/** Owned temporary checkout removed after success or failure */
const root = await mkdtemp(join(tmpdir(), "contract-tauri-"));
/** Caller-owned Cargo target, contract-test cache, or the fixture's temporary target, in that order */
const target =
  process.env.CARGO_TARGET_DIR ??
  (process.env.RUST_CONTRACT_TARGET_DIR === undefined
    ? join(root, "target")
    : join(resolve(process.env.RUST_CONTRACT_TARGET_DIR), "tauri"));
/** Webview profile, cache and configuration of the launched application instead of the user's home */
const profile = {
  XDG_DATA_HOME: join(root, "profile/data"),
  XDG_CACHE_HOME: join(root, "profile/cache"),
  XDG_CONFIG_HOME: join(root, "profile/config"),
};
/** Inherited toolchain environment with the owned or caller-selected Cargo target */
const toolchain: NodeJS.ProcessEnv = {
  ...process.env,
  CARGO_TARGET_DIR: target,
  CONTRACT_GENERATOR_TAURI_ROOT: root,
};
// The managed shared CARGO_BUILD_BUILD_DIR is not inherited: this temporary copy's intermediates must stay under its target.
delete toolchain.CARGO_BUILD_BUILD_DIR;
/** Setup and build inside the owned checkout with a finite safety bound */
const inCheckout: Execution = { cwd: root, env: toolchain, limit: 900_000 };
/** Owned checkout with its fixture inputs */
const checkout: Checkout = { repository, fixture, lock, execution: inCheckout };

/** Exact accepted native inputs including the locked Tauri and webview resolution
 * @returns Completion after emitting the resolved identities
 * @throws {@link Error} Missing native library or a host resolution other than the pinned Tauri/Wry crates
 */
async function reportInputs(): Promise<void> {
  const rustc = (await run(process.env.RUSTC ?? "rustc", ["--version"], inCheckout)).trim();
  const cargo = (await run("cargo", ["--version"], inCheckout)).trim();
  const libraries = ["--modversion", "gtk+-3.0", "webkit2gtk-4.1", "libsoup-3.0"];
  const native = (await run("pkg-config", libraries, inCheckout)).trim().split("\n");
  const edges = [
    "--offline",
    "--locked",
    "--manifest-path",
    "host/Cargo.toml",
    "--edges",
    "normal,build",
    "--prefix",
    "none",
  ];
  const tree = await run("cargo", ["tree", ...edges], inCheckout);
  const selected = tree
    .split("\n")
    .filter((line) => /^(tauri|tauri-build|tauri-runtime-\S+|wry) v/.test(line));
  const crates = [...new Set(selected.map((line) => line.replace(/ \(\*\)$/, "")))].sort();
  assert.deepEqual(
    crates,
    pinnedCrates,
    "The host must select exactly the pinned Tauri/Wry runtime",
  );
  const lockSha256 = createHash("sha256")
    .update(await readFile(lock))
    .digest("hex");
  console.log(
    JSON.stringify({ event: "fixture-inputs", rustc, cargo, native, crates, lockSha256 }),
  );
}

/** Dependency cache population under the tracked resolution or an explicit initial adoption
 * @returns Completion after the fetch and the input report
 * @throws {@link Error} Implicit lock creation, replacement of the tracked lock, unavailable registry or invalid resolution
 */
async function prepare(): Promise<void> {
  const tracked = existsSync(lock);
  const refusal = tracked
    ? "--create-lock refuses to replace the tracked Cargo.lock"
    : "Initial resolution requires explicit prepare --create-lock; ordinary prepare never creates or updates a lockfile";
  assert.ok(tracked !== createLock, refusal);
  await run(
    "cargo",
    ["fetch", ...(tracked ? ["--locked"] : []), "--manifest-path", "host/Cargo.toml"],
    inCheckout,
  );
  if (!tracked) await copyFile(join(root, "host/Cargo.lock"), lock);
  await reportInputs();
  console.log(
    `Tauri dependency cache prepared under ${tracked ? "the tracked" : "a newly adopted"} tests/fixtures/tauri/Cargo.lock`,
  );
}

/** Native application run under an owned headless display or the caller's visible display
 * @param binary - Built Wry host executable
 * @returns Complete standard output of the application
 * @throws {@link Error} Unavailable display, abnormal exit or exceeded safety bound
 */
async function launch(binary: string): Promise<string> {
  if (mode === "open") {
    const visible = {
      ...inCheckout,
      env: { ...toolchain, ...profile, CONTRACT_GENERATOR_TAURI_OPEN: "1" },
    };
    return run("dbus-run-session", ["--", binary], visible);
  }
  const runtime = join(root, "profile/runtime");
  await mkdir(runtime, { recursive: true, mode: 0o700 });
  const env: NodeJS.ProcessEnv = {
    ...toolchain,
    ...profile,
    XDG_RUNTIME_DIR: runtime,
    GDK_BACKEND: "x11",
    LIBGL_ALWAYS_SOFTWARE: "1",
    WEBKIT_DISABLE_DMABUF_RENDERER: "1",
  };
  delete env.WAYLAND_DISPLAY;
  delete env.DISPLAY;
  delete env.DBUS_SESSION_BUS_ADDRESS;
  const display = ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1024x768x24", binary];
  return run("dbus-run-session", ["--", ...display], { ...inCheckout, env, limit: smokeLimit });
}

/** Offline real Wry acceptance through the actual webview and event loop
 * @returns Completion after successful webview evidence and orderly shutdown
 * @throws {@link Error} Failed build, unavailable runtime, incomplete scenario or abnormal shutdown
 */
async function accept(): Promise<void> {
  assert.ok(
    existsSync(lock),
    "Missing tests/fixtures/tauri/Cargo.lock: run the documented prepare command before offline acceptance",
  );
  const compiler = join(repository, "node_modules/typescript-native/bin/tsc");
  await run(process.execPath, [compiler, "--project", "tsconfig.json"], inCheckout);
  const bundle = ["build", "--config", join(fixture, "vite.config.ts")];
  await run(join(repository, "node_modules/.bin/vp"), bundle, { ...inCheckout, cwd: repository });
  await reportInputs();
  await run(
    "cargo",
    ["build", "--offline", "--locked", "--manifest-path", "host/Cargo.toml"],
    inCheckout,
  );
  const output = await launch(join(target, "debug/contract-tauri-acceptance"));
  const events = output
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .map((line): unknown => JSON.parse(line));
  const reported = (name: string) =>
    events.some(
      (event) =>
        typeof event === "object" &&
        event !== null &&
        "event" in event &&
        event.event === name &&
        "passed" in event &&
        event.passed === true,
    );
  assert.ok(
    reported("webview-result"),
    "The actual webview did not report a complete successful scenario",
  );
  assert.ok(
    reported("host-exit"),
    "The real event loop did not complete orderly shutdown after acceptance",
  );
}

try {
  for (const directory of Object.values(profile)) await mkdir(directory, { recursive: true });
  await materialize(checkout);
  await (mode === "prepare" ? prepare() : accept());
} finally {
  await rm(root, { recursive: true, force: true });
}
