import { mkdir, mkdtemp, readFile, realpath, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Ok, type Result } from "ts-results-es";
import { copySources } from "./copy-sources.ts";
import { dependencies, type DevenvLock, type PreparedSource } from "./dependencies.ts";
import { inspectDestination } from "./destination.ts";
import { inspect } from "./entries.ts";
import { refuse, type Refusal } from "./refusal.ts";
import { resolveSource, type SourceHasher } from "./source.ts";

/** Everything that preparation reads from outside the repository */
export interface PreparationOptions {
  /** Repository root that owns `devenv.lock` and `work/` */
  readonly root: string;
  /** Process environment naming the immutable source paths */
  readonly environment: NodeJS.ProcessEnv;
  /** Content hash of a source tree */
  readonly hashSource: SourceHasher;
}

/** Completed preparation */
export interface PreparationReport {
  /** Published native dependency root */
  readonly destination: string;
  /** Pinned sources that were copied */
  readonly sources: readonly PreparedSource[];
}

/**
 * Authentication of every pinned source before anything is written
 * @param options - Repository root, environment and hashing
 * @returns Content-checked sources in publication order or the first refusal
 * @throws {@link Error} Filesystem or hashing failure
 */
async function resolveSources(
  options: PreparationOptions,
): Promise<Result<PreparedSource[], Refusal>> {
  const lock = JSON.parse(await readFile(join(options.root, "devenv.lock"), "utf8")) as DevenvLock;
  const sources: PreparedSource[] = [];
  for (const dependency of dependencies) {
    const source = await resolveSource(dependency, lock, options.environment, options.hashSource);
    if (source.isErr()) return source;
    sources.push(source.value);
  }
  return Ok(sources);
}

/**
 * Existence of the work directory that holds the prepared tree
 * @param work - Work directory path
 * @returns Success once the directory exists, or the refusal of a non-directory entry
 * @throws {@link Error} Filesystem failure while inspecting or creating the directory
 */
async function ensureWorkDirectory(work: string): Promise<Result<void, Refusal>> {
  const entry = await inspect(work);
  if (entry === undefined) await mkdir(work);
  else if (!entry.isDirectory())
    return refuse("unsafe-work-directory", `Refusing unsafe work directory: ${work}`);
  return Ok.EMPTY;
}

/**
 * Replacement of the owned tree by a freshly copied one, with return of the previous tree on failure
 * @param work - Work directory that receives the staging directory
 * @param destination - Published native dependency root
 * @param sources - Content-checked pinned inputs
 * @returns Success after publication or the refusal found while copying or re-inspecting
 * @throws {@link AggregateError} Publication failure whose recovery of the previous tree also failed
 * @throws {@link Error} Filesystem failure
 */
async function replaceDestination(
  work: string,
  destination: string,
  sources: readonly PreparedSource[],
): Promise<Result<void, Refusal>> {
  const staging = await mkdtemp(join(work, ".native-dependencies-"));
  const next = join(staging, "next");
  const previous = join(staging, "previous");
  let preserveRecovery = false;
  try {
    const copied = await copySources(next, sources);
    if (copied.isErr()) return copied;
    const replacing = await inspectDestination(destination);
    if (replacing.isErr()) return replacing;
    if (replacing.value) await rename(destination, previous);
    try {
      await rename(next, destination);
    } catch (error) {
      if (!replacing.value) throw error;
      try {
        await rename(previous, destination);
      } catch (recoveryError) {
        preserveRecovery = true;
        throw new AggregateError(
          [error, recoveryError],
          `Previous sources preserved at ${previous}`,
        );
      }
      throw error;
    }
    return Ok.EMPTY;
  } finally {
    if (!preserveRecovery) await rm(staging, { recursive: true, force: true });
  }
}

/**
 * Replacement of the complete owned sibling tree without stale source files
 * @param options - Repository root, environment and hashing
 * @returns The published root and copied sources, or the refusal that stopped preparation
 * @throws {@link AggregateError} Publication failure with failed source recovery
 * @throws {@link Error} Filesystem or hashing failure
 */
export async function prepareNativeFixtures(
  options: PreparationOptions,
): Promise<Result<PreparationReport, Refusal>> {
  const root = await realpath(options.root);
  const sources = await resolveSources({ ...options, root });
  if (sources.isErr()) return sources;
  const work = join(root, "work");
  const workDirectory = await ensureWorkDirectory(work);
  if (workDirectory.isErr()) return workDirectory;
  const destination = join(work, "native-dependencies");
  const existing = await inspectDestination(destination);
  if (existing.isErr()) return existing;
  const replaced = await replaceDestination(work, destination, sources.value);
  if (replaced.isErr()) return replaced;
  return Ok({ destination, sources: sources.value });
}
