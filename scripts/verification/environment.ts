import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { release } from "node:os";
import { executableIdentity } from "./executables.ts";
import { sizeOf, suiteNames } from "./suites.ts";
import type { Check } from "./inputs.ts";

/** Non-secret environment passed to verification subprocesses */
const environmentNames = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
  "TZ",
  "DOTNET_ROOT",
  "DOTNET_ROOT_X64",
  "DOTNET_CLI_HOME",
  "DOTNET_MULTILEVEL_LOOKUP",
  "DOTNET_ROLL_FORWARD",
  "NUGET_PACKAGES",
  "TypeModelingProjectPath",
  "EffectSystemProjectPath",
  "CARGO_HOME",
  "RUSTUP_HOME",
  "RUSTUP_TOOLCHAIN",
  "RUST_CONTRACT_TARGET_DIR",
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "LD_LIBRARY_PATH",
  "LIBRARY_PATH",
  "PKG_CONFIG_PATH",
  "PKG_CONFIG_LIBDIR",
  "C_INCLUDE_PATH",
  "CPLUS_INCLUDE_PATH",
  "CPATH",
  "NIX_CFLAGS_COMPILE",
  "NIX_LDFLAGS",
  "NIX_CC",
  "NIX_BINTOOLS",
  "NIX_STORE",
  "NIX_BUILD_CORES",
  "NIX_SSL_CERT_FILE",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "FONTCONFIG_FILE",
  "FONTCONFIG_PATH",
  "XDG_DATA_DIRS",
  "GIO_EXTRA_MODULES",
  "GSETTINGS_SCHEMA_DIR",
  "GTK_PATH",
  "WEBKIT_DISABLE_DMABUF_RENDERER",
  "WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS",
  "LIBGL_ALWAYS_SOFTWARE",
  "CC",
  "CXX",
  "AR",
  "RUSTC",
  "CARGO_BUILD_JOBS",
  "XDG_CACHE_HOME",
] as const;

/** Forwarded variables that describe the calling session and why none of them can change a result
 *
 * They reach the checks but stay out of the evidence key. Every other forwarded name selects a toolchain,
 * a library, a locale or a dependency location, and stays in it.
 */
const callerVariables: Readonly<Record<string, string>> = {
  PATH: "the caller's search path; a tool is identified by the file its name resolves to",
  USER: "login name of the calling session, which no check reads",
  LOGNAME: "login name of the calling session, which no check reads",
  TMPDIR: "per-session temporary location",
  TMP: "per-session temporary location",
  TEMP: "per-session temporary location",
  DISPLAY: "GUI session of the caller; the WebView acceptance starts its own Xvfb display",
  WAYLAND_DISPLAY: "GUI session of the caller; the WebView acceptance starts its own Xvfb display",
  XDG_RUNTIME_DIR: "runtime directory of the caller; the WebView acceptance makes its own",
  DBUS_SESSION_BUS_ADDRESS:
    "bus of the caller; the WebView acceptance removes it and starts its own",
  CARGO_BUILD_JOBS: "parallelism, which changes the duration of a build and not its result",
  NIX_BUILD_CORES: "parallelism, which changes the duration of a build and not its result",
};

/** Nix wrapper markers that enable the shell's host compiler and linker flags */
const nativeWrapperTargetName = /^NIX_(?:CC|BINTOOLS)_WRAPPER_TARGET_HOST_[a-z0-9_]+$/;

/** Deterministic public-tool environment without credential forwarding
 * @returns Environment shared by fingerprint probes and check execution
 */
export function verificationEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of environmentNames)
    if (process.env[name] !== undefined) env[name] = process.env[name];
  for (const name in process.env)
    if (nativeWrapperTargetName.test(name) && process.env[name] !== undefined)
      env[name] = process.env[name];
  return {
    ...env,
    CI: "1",
    NO_COLOR: "1",
    DOTNET_NOLOGO: "1",
    DOTNET_CLI_UI_LANGUAGE: "en",
    DOTNET_CLI_TELEMETRY_OPTOUT: "1",
    VSLANG: "1033",
    RUST_CONTRACT_FETCH: "0",
  };
}

/** Required executable identity without build or installation
 * @param command - Executable and version arguments
 * @param env - Actual check environment
 * @returns Observed successful tool output
 * @throws {@link Error} Missing executable or nonzero identity probe
 */
export function probe(command: readonly string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync(command[0]!, command.slice(1), {
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error !== undefined || result.status !== 0)
    throw new Error(
      `Required environment unavailable: ${command.join(" ")}: ${result.error?.message ?? result.stderr}`,
    );
  return result.stdout.trim();
}

/** Native dependency roots including imported props and analyzer sources
 * @param env - Actual check environment
 * @returns Complete copied dependency checkout roots
 * @throws {@link Error} Unset or missing dependency project
 */
export function csharpDependencyRoots(env: NodeJS.ProcessEnv): string[] {
  return ["TypeModelingProjectPath", "EffectSystemProjectPath"].map((name) => {
    const project = env[name];
    if (project === undefined || !existsSync(project))
      throw new Error(
        `Required ${name} source project unavailable; enter devenv shell and run npm run prepare:native`,
      );
    return realpathSync(join(dirname(project), "../.."));
  });
}

/** Release number of a Rust tool from its `-vV` identity
 * @param tool - Tool name printed first
 * @param identity - Output of `<tool> -vV`
 * @returns Release such as `1.94.0`, or no release when the identity has another shape
 */
export function rustRelease(tool: string, identity: string): string | undefined {
  return new RegExp(`^${tool} (\\d+\\.\\d+\\.\\d+)(?: |$)`, "m").exec(identity)?.[1];
}

/** Exact compiler release that the canonical Rust acceptance runs on
 * @param tools - Observed `-vV` identities of the compiler and the package manager
 * @param required - Release exported as the supported Rust floor
 * @throws {@link Error} Compiler or package manager of any other release, including a newer one
 */
export function requireExactRust(
  tools: Readonly<Record<"rustc" | "cargo", string>>,
  required: string,
): void {
  for (const tool of ["rustc", "cargo"] as const) {
    const release = rustRelease(tool, tools[tool]);
    if (release !== required)
      throw new Error(
        `Rust acceptance requires ${tool} ${required}; found ${release ?? "an unrecognized identity"}; enter devenv shell`,
      );
  }
}

/** Current public verifier environment identity
 * @param check - Required check
 * @param env - Explicit check environment
 * @param requiredRust - Release that `rustc` and `cargo` must equal for the `rust` collection, or no requirement
 * @returns Non-secret tool and environment evidence, including the files that executable names resolve to and the required Rust release
 * @throws {@link Error} Missing tool or a Rust release other than the required one
 */
export function environmentIdentity(
  check: Check,
  env: NodeJS.ProcessEnv,
  requiredRust?: string,
): unknown {
  const suite = suiteNames.find((name) => name === check);
  const tools: Record<string, string> = {};
  if (check === "check") tools.git = probe(["git", "--version"], env);
  if (suite !== undefined)
    tools.sandbox =
      sizeOf(suite) === "small"
        ? probe(["unshare", "--version"], env)
        : probe(["bwrap", "--version"], env);
  if (suite === "csharp") {
    tools.dotnet = probe(["dotnet", "--info"], env);
    csharpDependencyRoots(env);
  }
  if (suite === "rust" || suite === "tauri") {
    const rustc = probe([env.RUSTC ?? "rustc", "-vV"], env);
    const cargo = probe(["cargo", "-vV"], env);
    Object.assign(tools, { rustc, cargo, clippy: probe(["cargo", "clippy", "--version"], env) });
    if (suite === "rust" && requiredRust !== undefined) {
      requireExactRust({ rustc, cargo }, requiredRust);
      tools.requiredRust = requiredRust;
    }
  }
  if (suite === "tauri") {
    tools.webkit = probe(
      ["pkg-config", "--modversion", "gtk+-3.0", "webkit2gtk-4.1", "libsoup-3.0"],
      env,
    );
  }
  return {
    node: process.version,
    executable: realpathSync(process.execPath),
    platform: process.platform,
    arch: process.arch,
    kernel: release(),
    env: stableEnvironment(env),
    executables: executableIdentity(check, env),
    tools,
  };
}

/** Environment without the values that only describe the calling session
 * @param env - Explicit check environment
 * @returns Variables whose values can change a check result
 */
export function stableEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !Object.hasOwn(callerVariables, name)),
  );
}
