import { chmod, cp, lstat, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Ok, type Result } from "ts-results-es";
import { ownershipFile, rootInput, sourceOwner, type PreparedSource } from "./dependencies.ts";
import { refuse, type Refusal } from "./refusal.ts";

/**
 * Writable copy permissions without symbolic-link traversal
 * @param path - Copied source entry
 * @returns Completion of owner permission preparation or the refusal of an unsupported entry
 * @throws {@link Error} Filesystem failure while reading or changing permissions
 */
export async function makeWritable(path: string): Promise<Result<void, Refusal>> {
  const entry = await lstat(path);
  if (entry.isSymbolicLink()) return Ok.EMPTY;
  if (entry.isDirectory()) {
    await chmod(path, entry.mode | 0o700);
    for (const child of await readdir(path)) {
      const done = await makeWritable(join(path, child));
      if (done.isErr()) return done;
    }
    return Ok.EMPTY;
  }
  if (!entry.isFile()) return refuse("unsupported-entry", `Unsupported source entry: ${path}`);
  await chmod(path, entry.mode | 0o600);
  return Ok.EMPTY;
}

/**
 * Provenance document that a marker file carries
 * @param value - Marker content
 * @returns Stable JSON text with a trailing newline
 */
function markerText(value: object): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * Fresh writable sibling sources with immutable provenance
 * @param destination - New unpublished dependency root
 * @param sources - Content-checked pinned inputs
 * @returns Completion of source copying or the refusal of an unsupported source entry
 * @throws {@link Error} Copy or provenance publication failure
 */
export async function copySources(
  destination: string,
  sources: readonly PreparedSource[],
): Promise<Result<void, Refusal>> {
  await mkdir(destination);
  const provenance = sources.map((source) => ({
    input: source.dependency.input,
    repository: source.repository,
    revision: source.revision,
    narHash: source.narHash,
  }));
  for (const source of sources) {
    const target = join(destination, source.dependency.input);
    await cp(source.path, target, {
      recursive: true,
      force: false,
      errorOnExist: true,
      verbatimSymlinks: true,
    });
    const writable = await makeWritable(target);
    if (writable.isErr()) return writable;
    const own = provenance.find((entry) => entry.input === source.dependency.input);
    await writeFile(join(target, ownershipFile), markerText({ owner: sourceOwner, ...own }), {
      flag: "wx",
    });
  }
  await writeFile(
    join(destination, ownershipFile),
    markerText({ owner: sourceOwner, input: rootInput, sources: provenance }),
    { flag: "wx" },
  );
  return Ok.EMPTY;
}
