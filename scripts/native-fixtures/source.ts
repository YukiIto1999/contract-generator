import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { Ok, type Result } from "ts-results-es";
import type { Dependency, DevenvLock, LockedSource, PreparedSource } from "./dependencies.ts";
import { inspect } from "./entries.ts";
import { refuse, type Refusal } from "./refusal.ts";

/** Content hash of a source tree in the lock's SRI notation */
export type SourceHasher = (path: string) => Promise<string>;

/** Promise-based Nix source hashing command */
const executeFile = promisify(execFile);

/**
 * Nix content hash of a source tree
 * @param path - Immutable source root
 * @returns SRI sha256 of the tree as `nix hash path` reports it
 * @throws {@link Error} The hashing command is unavailable or failed
 */
export async function nixHashPath(path: string): Promise<string> {
  const { stdout } = await executeFile("nix", ["hash", "path", "--type", "sha256", "--sri", path]);
  return stdout.trim();
}

/**
 * Immutable GitHub identity that the lock pins for an input
 * @param dependency - Required source input
 * @param lock - Authoritative devenv input graph
 * @returns The locked source or the refusal of a missing or malformed pin
 */
function lockedSource(dependency: Dependency, lock: DevenvLock): Result<LockedSource, Refusal> {
  const reference = lock.nodes[lock.root]?.inputs?.[dependency.input];
  const source = typeof reference === "string" ? lock.nodes[reference]?.locked : undefined;
  if (
    source?.type !== "github" ||
    source.owner !== "YukiIto1999" ||
    source.repo !== dependency.input ||
    !/^[a-f0-9]{40}$/.test(source.rev) ||
    typeof source.narHash !== "string" ||
    !/^sha256-[A-Za-z0-9+/]{43}=$/.test(source.narHash)
  )
    return refuse(
      "missing-source-lock",
      `Missing immutable GitHub source in devenv.lock: ${dependency.input}`,
    );
  return Ok(source);
}

/**
 * Pinned source authentication before destination mutation
 * @param dependency - Required source input
 * @param lock - Authoritative devenv input graph
 * @param environment - Process environment naming the immutable source paths
 * @param hashSource - Content hash of a source tree
 * @returns Content-checked immutable source provenance or the refusal
 * @throws {@link Error} Filesystem or hashing failure
 */
export async function resolveSource(
  dependency: Dependency,
  lock: DevenvLock,
  environment: NodeJS.ProcessEnv,
  hashSource: SourceHasher,
): Promise<Result<PreparedSource, Refusal>> {
  const locked = lockedSource(dependency, lock);
  if (locked.isErr()) return locked;
  const source = locked.value;
  const configuredPath = environment[dependency.sourceVariable];
  if (configuredPath === undefined || configuredPath === "")
    return refuse(
      "missing-environment",
      `Activate devenv shell before preparation: ${dependency.sourceVariable} is missing`,
    );
  const path = await realpath(configuredPath);
  if ((await hashSource(path)) !== source.narHash)
    return refuse(
      "source-hash-mismatch",
      `Source content does not match devenv.lock: ${dependency.input}`,
    );
  if (!(await inspect(join(path, dependency.project)))?.isFile())
    return refuse("missing-project", `Pinned source is missing project: ${dependency.project}`);
  return Ok({
    dependency,
    path,
    repository: `https://github.com/${source.owner}/${source.repo}.git`,
    revision: source.rev,
    narHash: source.narHash,
  });
}
