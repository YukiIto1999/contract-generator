import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Ok, type Result } from "ts-results-es";
import { dependencies, ownershipFile, rootInput, sourceOwner } from "./dependencies.ts";
import { inspect } from "./entries.ts";
import { refuse, type Refusal } from "./refusal.ts";

/**
 * Ownership marker of a destination directory
 * @param markerPath - Marker file path
 * @returns Parsed marker or undefined when the file is not valid JSON
 * @throws {@link Error} Filesystem failure while reading the marker
 */
async function readMarker(markerPath: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(markerPath, "utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/**
 * Ownership of a marker value
 * @param marker - Untrusted marker content
 * @param input - Expected source input identity
 * @returns Whether the marker names this generator and the expected input
 */
function isOwnedBy(marker: unknown, input: string): boolean {
  return (
    marker !== null &&
    typeof marker === "object" &&
    "owner" in marker &&
    marker.owner === sourceOwner &&
    "input" in marker &&
    marker.input === input
  );
}

/**
 * Ownership prerequisite for destructive source replacement
 * @param path - Existing owned directory
 * @param input - Expected source input identity
 * @returns Success for an owned real directory, otherwise the refusal
 * @throws {@link Error} Filesystem failure while inspecting the directory or its marker
 */
export async function requireOwnership(
  path: string,
  input: string,
): Promise<Result<void, Refusal>> {
  if (!(await inspect(path))?.isDirectory())
    return refuse(
      "unsafe-destination",
      `Refusing non-directory or symbolic-link destination: ${path}`,
    );
  const markerPath = join(path, ownershipFile);
  if (!(await inspect(markerPath))?.isFile())
    return refuse("unowned-destination", `Refusing unowned destination: ${path}`);
  if (!isOwnedBy(await readMarker(markerPath), input))
    return refuse("unowned-destination", `Refusing unowned destination: ${path}`);
  return Ok.EMPTY;
}

/**
 * Existing sibling tree ownership prerequisite
 * @param destination - Published native dependency root
 * @returns Presence of an owned tree eligible for replacement, or the refusal
 * @throws {@link Error} Filesystem failure while inspecting the tree
 */
export async function inspectDestination(destination: string): Promise<Result<boolean, Refusal>> {
  if ((await inspect(destination)) === undefined) return Ok(false);
  const root = await requireOwnership(destination, rootInput);
  if (root.isErr()) return root;
  const allowedEntries = new Set([
    ownershipFile,
    ...dependencies.map((dependency) => dependency.input),
  ]);
  for (const entry of await readdir(destination)) {
    if (!allowedEntries.has(entry))
      return refuse("unowned-entry", `Refusing unowned entry: ${join(destination, entry)}`);
  }
  for (const dependency of dependencies) {
    const path = join(destination, dependency.input);
    if ((await inspect(path)) === undefined) continue;
    const owned = await requireOwnership(path, dependency.input);
    if (owned.isErr()) return owned;
  }
  return Ok(true);
}
