import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Err, Ok, type Result } from "ts-results-es";
import type { GeneratedFile } from "../model/contract-model.js";
import { filesystemMessage } from "./filesystem-error.js";
import type { ExistingOutput } from "./inspect-output.js";
import { manifestName, ownedDirectories, type OutputManifest } from "./output-manifest.js";
import { createWorkspace, discardWorkspace, type Workspace } from "./publication-workspace.js";
import { refusal, type PublicationFailure, type PublicationReceipt } from "./publication-result.js";

/** Outcome of the attempt to move the staged tree into place */
type Swap = { readonly published: true } | { readonly published: false; readonly message: string };

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

/** Replacement of the output path by the staged tree
 * @param root - Verified output root
 * @param workspace - Owned workspace holding the staged tree
 * @param replacing - Whether a previous tree occupies the output path
 * @returns Publication or a failure after the previous tree was returned to its path
 * @throws {@link Error} A defect that is not a filesystem failure, after the previous tree was returned
 */
async function moveIntoPlace(
  root: string,
  workspace: Workspace,
  replacing: boolean,
): Promise<Swap> {
  let displaced = false;
  try {
    if (replacing) await rename(root, workspace.displaced);
    displaced = replacing;
    await rename(workspace.staged, root);
    return { published: true };
  } catch (error) {
    const stranded = displaced ? await restoreDisplaced(root, workspace) : undefined;
    const message = filesystemMessage(error);
    if (stranded === undefined) return { published: false, message };
    return {
      published: false,
      message: `${message}; previous output preserved at ${workspace.displaced}; rollback failed: ${stranded}`,
    };
  }
}

/** Staging followed by replacement of the output path
 * @param root - Verified output root
 * @param workspace - Owned workspace of this attempt
 * @param previous - Verified previous destination
 * @param files - Complete generated artifacts
 * @param manifest - Complete generated identities
 * @returns Publication or a failure that left the previous output in place
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
  } catch (error) {
    return { published: false, message: filesystemMessage(error) };
  }
  return moveIntoPlace(root, workspace, previous !== undefined);
}

/** Directory replacement with rollback before successful publication
 * @param root - Verified output root
 * @param previous - Verified previous destination
 * @param files - Complete generated artifacts
 * @param manifest - Complete generated identities
 * @returns Publication receipt or failure with explicit recovery ownership
 * @throws {@link Error} A defect that is not a filesystem failure, after the workspace was discarded
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
  return Err(refusal("output-io", swap.message, retainedPaths));
}
