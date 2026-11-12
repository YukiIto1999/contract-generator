import { lstat, mkdir, mkdtemp, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isFilesystemError, isMissing } from "./filesystem-error.js";

/** Length of the random suffix that `mkdtemp` appends to a prefix */
export const suffixLength = 6;

/** Sibling directory owned by one publication attempt */
export interface Workspace {
  /** Directory beside the output, named after the output and the generator */
  readonly path: string;
  /** Complete new tree prepared before it is moved into place */
  readonly staged: string;
  /** Location of the previous tree while it is out of place */
  readonly displaced: string;
}

/** Workspace layout below an existing directory
 * @param path - Workspace directory
 * @returns Paths of the staged and displaced trees
 */
export function workspaceAt(path: string): Workspace {
  return { path, staged: join(path, "staged"), displaced: join(path, "previous") };
}

/** Name prefix shared by every workspace of one output
 * @param root - Absolute output directory
 * @returns Prefix that identifies the output without ambiguity between sibling outputs
 */
export function workspacePrefix(root: string): string {
  return "." + basename(root) + ".contract-generator-publish-";
}

/** Fresh workspace beside the output
 * @param root - Absolute output directory
 * @returns Empty owned workspace in the output's parent directory
 * @throws {@link Error} Filesystem failure while creating the parent or the workspace
 */
export async function createWorkspace(root: string): Promise<Workspace> {
  await mkdir(dirname(root), { recursive: true });
  return workspaceAt(await mkdtemp(join(dirname(root), workspacePrefix(root))));
}

/** Whether the previous tree still lives in the workspace
 * @param workspace - Workspace of a finished attempt
 * @returns False only when the displaced tree is known to be absent
 * @throws {@link Error} A defect that is not a filesystem failure
 */
async function holdsPreviousTree(workspace: Workspace): Promise<boolean> {
  try {
    await lstat(workspace.displaced);
    return true;
  } catch (error) {
    if (!isFilesystemError(error)) throw error;
    return !isMissing(error);
  }
}

/** Removal of a finished workspace that never destroys the only copy of the previous tree
 * @param workspace - Workspace of a finished attempt
 * @param published - Whether the new tree is in place and the displaced tree is obsolete
 * @returns The workspace path when it must be retained, otherwise no path
 * @throws {@link Error} A defect that is not a filesystem failure
 */
export async function discardWorkspace(
  workspace: Workspace,
  published: boolean,
): Promise<readonly string[]> {
  if (!published && (await holdsPreviousTree(workspace))) return [workspace.path];
  try {
    await rm(workspace.path, { recursive: true, force: true });
    return [];
  } catch (error) {
    if (!isFilesystemError(error)) throw error;
    return [workspace.path];
  }
}
