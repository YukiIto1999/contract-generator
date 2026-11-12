import { lstat, mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { Err, Ok, type Result } from "ts-results-es";
import { isFilesystemError, isMissing } from "./filesystem-error.js";
import { refusal, type PublicationFailure } from "./publication-result.js";
import type { OwnedDirectory } from "./publication-workspace.js";

/** Canonical parent through any existing ancestors without creating directories
 * @param directory - Absolute parent directory that may not exist yet
 * @returns Parent path with existing symbolic links resolved
 * @throws {@link Error} Filesystem failure other than a missing ancestor
 */
async function canonicalParent(directory: string): Promise<string> {
  try {
    return await realpath(directory);
  } catch (error) {
    if (!isMissing(error)) throw error;
    return join(await canonicalParent(dirname(directory)), basename(directory));
  }
}

/** Output identity shared by paths through equivalent parent symbolic links
 * @param directory - Requested output path
 * @returns Absolute canonical-parent path without following the output entry itself
 * @throws {@link Error} Filesystem failure while resolving the parent
 */
export async function canonicalOutputPath(directory: string): Promise<string> {
  const absolute = resolve(directory);
  return join(await canonicalParent(dirname(absolute)), basename(absolute));
}

/** Stable exclusive marker beside one output
 * @param root - Canonical-parent output path
 * @returns Marker path independent of the lifetime of the output entry
 */
function ownershipPath(root: string): string {
  return join(dirname(root), "." + basename(root) + ".contract-generator.lock");
}

/** Refusal preserving an active or abandoned marker without inferring its lifetime
 * @param root - Canonical-parent output path
 * @returns Conflict with verified manual recovery instructions
 */
function ownershipConflict(root: string): PublicationFailure {
  const path = ownershipPath(root);
  return refusal(
    "output-conflict",
    `Publication ownership already exists at ${path}; it may be active or abandoned. Do not remove it while a publisher may still be running. After independently verifying that no publisher remains, inspect the output and sibling ${"." + basename(root)}.contract-generator-publish-* workspaces, preserve any previous tree, and remove only the verified ownership marker before rerunning publication for manifest-verified recovery`,
    [path],
  );
}

/** Read-only detection of any publication owner or unknown ownership residue
 * @param root - Canonical-parent output path
 * @returns Conflict when any entry occupies the ownership path
 * @throws {@link Error} Filesystem failure while probing ownership
 */
export async function inspectPublicationOwner(
  root: string,
): Promise<PublicationFailure | undefined> {
  try {
    await lstat(ownershipPath(root));
    return ownershipConflict(root);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

/** Immediate exclusive ownership without waiting or stealing abandoned markers
 * @param root - Canonical-parent output path
 * @returns Ownership of a fresh marker or a typed conflict
 * @throws {@link Error} Filesystem failure while creating the marker
 */
export async function acquirePublicationOwnership(
  root: string,
): Promise<Result<OwnedDirectory, PublicationFailure>> {
  const path = ownershipPath(root);
  await mkdir(dirname(root), { recursive: true });
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (isFilesystemError(error) && error.code === "EEXIST") return Err(ownershipConflict(root));
    throw error;
  }
  return Ok({ path, identity: await lstat(path) });
}
