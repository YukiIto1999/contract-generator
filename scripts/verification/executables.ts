import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { sizeOf } from "./suites.ts";
import type { Check } from "./inputs.ts";

/** Filesystem queries that locate an executable, replaceable where no real filesystem is readable */
export interface ExecutableFiles {
  /** Whether the path is an executable regular file */
  readonly isExecutable: (path: string) => boolean;
  /** Real path after every link */
  readonly realPath: (path: string) => string;
}

/** Queries against the machine that runs the verification */
const machineFiles: ExecutableFiles = {
  isExecutable: (path) => {
    try {
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch {
      return false;
    }
  },
  realPath: (path) => realpathSync(path),
};

/** Tools that a Rust build starts by name besides the compiler and the package manager */
const rustToolchain = ["cargo", "cargo-clippy", "cc", "pkg-config"];
/** Session tools that the WebView acceptance starts by name */
const webViewSession = ["dbus-run-session", "xvfb-run"];

/** Names that a check starts through the search path
 *
 * The caller's search path is not part of the evidence key, so a tool is identified by the file its name resolves to.
 * Node, `vp` and `tsc` come from the runner and the installed dependencies, whose identity the key holds already.
 * `git` is not listed: `check` only asks it for the file list, which no git build changes.
 * @param check - Required check
 * @param env - Actual check environment
 * @returns Sorted unique executable names
 */
export function executableNames(check: Check, env: NodeJS.ProcessEnv): string[] {
  if (check === "build" || check === "typecheck" || check === "check") return [];
  const names = [sizeOf(check) === "small" ? "unshare" : "bwrap"];
  if (check === "csharp") names.push("dotnet");
  if (check === "rust" || check === "tauri")
    names.push(
      env.RUSTC ?? "rustc",
      ...rustToolchain,
      ...[env.CC, env.CXX, env.AR].filter((name) => name !== undefined),
    );
  if (check === "tauri") names.push(...webViewSession);
  return [...new Set(names)].sort();
}

/** File that a name resolves to the way the operating system resolves it
 * @param name - Executable name, or a path that holds a separator
 * @param searchPath - Directories separated by the platform delimiter
 * @param files - Filesystem queries
 * @returns Resolved executable path or no file
 */
function resolve(name: string, searchPath: string, files: ExecutableFiles): string | undefined {
  if (name.includes("/")) return files.isExecutable(name) ? name : undefined;
  return searchPath
    .split(delimiter)
    .map((directory) => join(directory === "" ? "." : directory, name))
    .find((candidate) => files.isExecutable(candidate));
}

/** Real files that the names of a check resolve to
 * @param check - Required check
 * @param env - Actual check environment
 * @param files - Filesystem queries
 * @returns Real path per executable name
 * @throws {@link Error} Name that the search path does not hold
 */
export function executableIdentity(
  check: Check,
  env: NodeJS.ProcessEnv,
  files: ExecutableFiles = machineFiles,
): Record<string, string> {
  return Object.fromEntries(
    executableNames(check, env).map((name) => {
      const found = resolve(name, env.PATH ?? "", files);
      if (found === undefined)
        throw new Error(
          `Required executable ${name} is not on the search path; enter devenv shell from the repository root`,
        );
      return [name, files.realPath(found)];
    }),
  );
}
