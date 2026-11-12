import type { Stats } from "node:fs";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Err, Ok, type Result } from "ts-results-es";
import { isMissing } from "./filesystem-error.js";
import {
  digest,
  manifestName,
  ownedDirectories,
  parseManifest,
  type FileDigest,
  type OutputManifest,
} from "./output-manifest.js";
import { refusal, type PublicationFailure } from "./publication-result.js";

/** Verified destination state before replacement */
export interface ExistingOutput {
  /** Ownership of a nonempty destination */
  readonly manifest: OutputManifest | null;
  /** Existing destination permission bits */
  readonly mode: number;
  /** Filesystem device of the inspected destination */
  readonly device: number;
  /** Filesystem entry identity before staging */
  readonly inode: number;
}

/** Inventory without traversing unowned directories or symbolic links
 * @param root - Destination root
 * @param directories - Directories justified by owned artifacts
 * @param relative - Current relative directory
 * @returns Existing file identities and unexpected entries
 */
async function inventory(
  root: string,
  directories: ReadonlySet<string>,
  relative = "",
): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(join(root, relative), { withFileTypes: true })) {
    const path = relative === "" ? entry.name : relative + "/" + entry.name;
    if (entry.isFile()) found.push(path);
    else if (entry.isDirectory() && directories.has(path))
      found.push(...(await inventory(root, directories, path)));
    else found.push(path + "/");
  }
  return found.sort();
}

/** Destination metadata without following a symbolic link
 * @param root - Absolute output directory
 * @returns Metadata of the destination entry or undefined when it does not exist
 * @throws {@link Error} Filesystem failure other than absence of the destination
 */
async function destinationStat(root: string): Promise<Stats | undefined> {
  try {
    return await lstat(root);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/** Marker and entries of a nonempty destination
 * @param root - Absolute output directory with at least one entry
 * @param entries - Names directly inside the destination
 * @returns Verified ownership marker or a refusal
 */
async function ownedManifest(
  root: string,
  entries: readonly string[],
): Promise<Result<OutputManifest, PublicationFailure>> {
  if (!entries.includes(manifestName))
    return Err(
      refusal("output-not-owned", "Nonempty output has no generator ownership marker: " + root),
    );
  const markerPath = join(root, manifestName);
  if (!(await lstat(markerPath)).isFile())
    return Err(
      refusal("output-not-owned", "Ownership marker is not a regular file: " + markerPath),
    );
  const manifest = parseManifest(await readFile(markerPath, "utf8"));
  if (manifest === undefined)
    return Err(refusal("output-not-owned", "Invalid generator ownership marker: " + markerPath));
  const expected = [manifestName, ...manifest.files.map((file) => file.path)].sort();
  const actual = await inventory(root, ownedDirectories(manifest.files));
  if (expected.length !== actual.length || expected.some((path, index) => path !== actual[index]))
    return Err(refusal("output-not-owned", "Output contains missing or unowned entries: " + root));
  return Ok(manifest);
}

/** Artifact that no longer matches the recorded identity
 * @param root - Absolute output directory
 * @param files - Recorded artifact identities
 * @returns Path of the first modified artifact or undefined when every artifact is intact
 */
async function modifiedArtifact(
  root: string,
  files: readonly FileDigest[],
): Promise<string | undefined> {
  for (const file of files) {
    if (digest(await readFile(join(root, file.path))) !== file.sha256) return file.path;
  }
  return undefined;
}

/** Ownership and edit protection before any destination mutation
 * @param root - Absolute output directory
 * @returns Verified existing destination or a refusal
 * @throws {@link Error} Filesystem failure while reading the destination
 */
export async function inspectOutput(
  root: string,
): Promise<Result<ExistingOutput | undefined, PublicationFailure>> {
  const stat = await destinationStat(root);
  if (stat === undefined) return Ok(undefined);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    return Err(refusal("output-not-owned", "Output is not an owned directory: " + root));
  const identity = { mode: stat.mode & 0o777, device: stat.dev, inode: stat.ino };
  const entries = await readdir(root);
  if (entries.length === 0) return Ok({ manifest: null, ...identity });
  const owned = await ownedManifest(root, entries);
  if (owned.isErr()) return Err(owned.error);
  const modified = await modifiedArtifact(root, owned.value.files);
  if (modified !== undefined)
    return Err(
      refusal("output-modified", "Generated artifact was modified outside generation: " + modified),
    );
  return Ok({ manifest: owned.value, ...identity });
}
