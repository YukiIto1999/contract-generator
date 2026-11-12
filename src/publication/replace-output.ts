import { chmod, lstat, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Err, Ok, type Result } from "ts-results-es";
import type { GeneratedFile } from "../model/contract-model.js";
import { filesystemMessage, isFilesystemError } from "./filesystem-error.js";
import { inspectOutput, type ExistingOutput } from "./inspect-output.js";
import {
  manifestName,
  ownedDirectories,
  sameOutput,
  type OutputManifest,
} from "./output-manifest.js";
import {
  createWorkspace,
  discardEmptyDirectory,
  discardWorkspace,
  type OwnedDirectory,
  type Workspace,
} from "./publication-workspace.js";
import { refusal, type PublicationFailure, type PublicationReceipt } from "./publication-result.js";

/** Outcome of the attempt to move the staged tree into place */
type Swap =
  | { readonly published: true }
  | { readonly published: false; readonly failure: PublicationFailure };

/** Complete tree preparation outside the published path
 * @param workspace - Owned workspace of this attempt
 * @param previous - Verified previous destination whose permission bits the new tree adopts
 * @param files - Validated output paths and contents
 * @param manifest - Complete artifact identities
 * @returns Completion after all file handles are closed
 * @throws {@link Error} Filesystem failure while writing the tree
 */
async function stageTree(
  workspace: Workspace,
  previous: ExistingOutput | undefined,
  files: readonly GeneratedFile[],
  manifest: OutputManifest,
): Promise<void> {
  // The operating system applies the process permission mask to a fresh directory, which is the
  // mode a new output directory would have; reading the mask itself would write process state.
  await mkdir(workspace.staged);
  if (previous !== undefined) await chmod(workspace.staged, previous.mode);
  for (const directory of ownedDirectories(manifest.files))
    await mkdir(join(workspace.staged, directory), { recursive: true });
  for (const file of files)
    await writeFile(join(workspace.staged, file.path), file.content, "utf8");
  await writeFile(
    join(workspace.staged, manifestName),
    JSON.stringify(manifest, null, 2) + "\n",
    "utf8",
  );
}

/** Return of the displaced tree to the output path
 * @param root - Verified output root
 * @param workspace - Owned workspace holding the displaced tree
 * @returns Explanation of a failed return or undefined when the previous output is back in place
 * @throws {@link Error} A defect that is not a filesystem failure
 */
async function restoreDisplaced(root: string, workspace: Workspace): Promise<string | undefined> {
  try {
    await rename(workspace.displaced, root);
    return undefined;
  } catch (error) {
    return filesystemMessage(error);
  }
}

/** Exclusive reservation before installing a tree at an initially missing output
 * @param root - Missing output path under exclusive publication ownership
 * @returns Identity of the reservation or refusal of an intervening destination
 * @throws {@link Error} Filesystem failure while reserving the destination
 */
async function reserveDestination(
  root: string,
): Promise<Result<OwnedDirectory, PublicationFailure>> {
  try {
    await mkdir(root);
  } catch (error) {
    if (isFilesystemError(error) && error.code === "EEXIST")
      return Err(
        refusal(
          "output-not-owned",
          "Output appeared before installation and was left untouched: " + root,
        ),
      );
    throw error;
  }
  return Ok({ path: root, identity: await lstat(root) });
}

/** Replacement of the output path by the staged tree
 * @param root - Verified output root
 * @param workspace - Owned workspace holding the staged tree
 * @param replacing - Whether a previous tree occupies the output path
 * @returns Publication or refusal with explicit preserved recovery paths
 * @throws {@link Error} A non-filesystem defect after safe reservation cleanup
 */
async function moveIntoPlace(
  root: string,
  workspace: Workspace,
  replacing: boolean,
): Promise<Swap> {
  let displaced = false;
  const reserved = replacing ? undefined : await reserveDestination(root);
  if (reserved?.isErr()) return { published: false, failure: reserved.error };
  try {
    if (replacing) await rename(root, workspace.displaced);
    displaced = replacing;
    await rename(workspace.staged, root);
    return { published: true };
  } catch (error) {
    const retainedPaths = reserved?.isOk() ? await discardEmptyDirectory(reserved.value) : [];
    const stranded = displaced ? await restoreDisplaced(root, workspace) : undefined;
    const message = filesystemMessage(error);
    if (stranded === undefined)
      return { published: false, failure: refusal("output-io", message, retainedPaths) };
    return {
      published: false,
      failure: refusal(
        "output-io",
        `${message}; previous output preserved at ${workspace.displaced}; rollback failed: ${stranded}`,
      ),
    };
  }
}

/** Protection of changes made to the destination during staging
 * @param root - Exclusively owned output path
 * @param previous - Destination identity verified before staging
 * @returns Refusal for a newly appeared or changed destination
 * @throws {@link Error} Filesystem failure while rechecking the destination
 */
async function verifyUnchangedDestination(
  root: string,
  previous: ExistingOutput | undefined,
): Promise<PublicationFailure | undefined> {
  const current = await inspectOutput(root);
  if (current.isErr()) return current.error;
  if (previous === undefined && current.value === undefined) return undefined;
  if (
    previous !== undefined &&
    current.value !== undefined &&
    previous.device === current.value.device &&
    previous.inode === current.value.inode &&
    (previous.manifest === null
      ? current.value.manifest === null
      : sameOutput(current.value.manifest, previous.manifest))
  )
    return undefined;
  return refusal(
    "output-not-owned",
    "Output changed during staging and was left untouched: " + root,
  );
}

/** Staging followed by replacement of the output path
 * @param root - Verified output root
 * @param workspace - Owned workspace of this attempt
 * @param previous - Verified previous destination
 * @param files - Complete generated artifacts
 * @param manifest - Complete generated identities
 * @returns Publication or refusal with preservation of the previous output
 * @throws {@link Error} A defect that is not a filesystem failure
 */
async function stageAndSwap(
  root: string,
  workspace: Workspace,
  previous: ExistingOutput | undefined,
  files: readonly GeneratedFile[],
  manifest: OutputManifest,
): Promise<Swap> {
  try {
    await stageTree(workspace, previous, files, manifest);
    const changed = await verifyUnchangedDestination(root, previous);
    if (changed !== undefined) return { published: false, failure: changed };
  } catch (error) {
    return { published: false, failure: refusal("output-io", filesystemMessage(error)) };
  }
  return moveIntoPlace(root, workspace, previous !== undefined);
}

/** Exclusively owned directory replacement with a recoverable gap between renames
 *
 * Rollback retains the displaced previous tree when it cannot return to the output path
 * @param root - Canonical-parent output path under exclusive publication ownership
 * @param previous - Verified previous destination
 * @param files - Complete generated artifacts
 * @param manifest - Complete generated identities
 * @returns Publication receipt or failure with explicit recovery ownership
 * @throws {@link Error} A non-filesystem defect after safe workspace cleanup
 */
export async function replaceOutput(
  root: string,
  previous: ExistingOutput | undefined,
  files: readonly GeneratedFile[],
  manifest: OutputManifest,
): Promise<Result<PublicationReceipt, PublicationFailure>> {
  const workspace = await createWorkspace(root);
  let swap: Swap;
  try {
    swap = await stageAndSwap(root, workspace, previous, files, manifest);
  } catch (defect) {
    await discardWorkspace(workspace, false);
    throw defect;
  }
  const retainedPaths = await discardWorkspace(workspace, swap.published);
  if (swap.published) return Ok({ changed: true, retainedPaths });
  return Err({ ...swap.failure, recoveryPaths: [...swap.failure.recoveryPaths, ...retainedPaths] });
}
