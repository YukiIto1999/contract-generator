import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { Size } from "./suites.ts";

/** Existing caller-owned Medium temporary, cache and build directories outside the repository
 * @param env - Explicit check environment
 * @returns Writable directories besides the repository and the sandbox-private `/tmp`
 */
export function mediumWritablePaths(env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? "";
  const repository = realpathSync(process.cwd());
  const candidates = [
    env.TMPDIR,
    env.TMP,
    env.TEMP,
    env.XDG_CACHE_HOME ?? join(home, ".cache"),
    env.CARGO_HOME ?? join(home, ".cargo"),
    env.RUST_CONTRACT_TARGET_DIR,
    env.NUGET_PACKAGES ?? join(home, ".nuget"),
    env.DOTNET_CLI_HOME === undefined
      ? join(home, ".dotnet")
      : join(env.DOTNET_CLI_HOME, ".dotnet"),
    join(home, ".local/share/NuGet"),
  ];
  // A directory inside the repository is not bound on its own: the repository bind already makes it writable,
  // and a bind that follows its existence would change the command between the start and the end of the first run.
  return [
    ...new Set(
      candidates
        .filter((path): path is string => path !== undefined && path !== "" && existsSync(path))
        .map((path) => realpathSync(path))
        .filter((path) => path !== repository && !path.startsWith(`${repository}/`)),
    ),
  ].sort();
}

/** Resource-restricting wrapper for one runner size
 * @param size - Resource size of the collection runner
 * @param env - Explicit check environment
 * @returns Literal wrapper arguments preceding the runner executable
 */
export function sandboxPrefix(size: Size, env: NodeJS.ProcessEnv): string[] {
  if (size === "small") return ["unshare", "--user", "--map-current-user", "--net", "--"];
  const repository = realpathSync(process.cwd());
  return [
    "bwrap",
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
    "--proc",
    "/proc",
    "--tmpfs",
    "/dev/shm",
    "--tmpfs",
    "/tmp",
    "--bind",
    repository,
    repository,
    ...mediumWritablePaths(env).flatMap((path) => ["--bind", path, path]),
    "--unshare-net",
    "--unshare-pid",
    "--die-with-parent",
    "--chdir",
    repository,
    "--",
  ];
}
