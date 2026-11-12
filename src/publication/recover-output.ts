import { lstat, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Err, Ok, type Result } from "ts-results-es";
import { compareText } from "../model/ordering.js";
import { isMissing } from "./filesystem-error.js";
import { inspectOutput, type ExistingOutput } from "./inspect-output.js";
import { refusal, type PublicationFailure } from "./publication-result.js";
import {
  discardWorkspace,
  suffixLength,
  workspaceAt,
  workspacePrefix,
  type Workspace,
} from "./publication-workspace.js";

/** Destination state after any recovery of an interrupted publication */
export interface RecoveredOutput {
  /** Verified previous destination, restored from an interrupted publication when it was missing */
  readonly previous: ExistingOutput | undefined;
  /** Owned temporary paths retained after a cleanup failure */
  readonly retainedPaths: readonly string[];
}

/** Workspace name of this output, as `mkdtemp` makes it
 * @param name - Entry name beside the output
 * @param prefix - Workspace name prefix of the output
 * @returns Whether the name is the prefix followed by exactly the random suffix
 */
function isWorkspaceName(name: string, prefix: string): boolean {
  return (
    name.length === prefix.length + suffixLength &&
    name.startsWith(prefix) &&
    /^[A-Za-z0-9]+$/.test(name.slice(prefix.length))
  );
}

/** Workspaces beside a missing output that still hold a displaced previous tree
 * @param root - Absolute output directory
 * @returns Workspaces of earlier attempts that lost the output path, in name order
 * @throws {@link Error} Filesystem failure while listing the parent or probing a workspace
 */
async function displacedWorkspaces(root: string): Promise<Workspace[]> {
  let names: string[];
  try {
    names = await readdir(dirname(root));
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
  const prefix = workspacePrefix(root);
  const found: Workspace[] = [];
  for (const name of names.filter((entry) => isWorkspaceName(entry, prefix)).sort(compareText)) {
    const workspace = workspaceAt(join(dirname(root), name));
    try {
      await lstat(workspace.displaced);
      found.push(workspace);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return found;
}

/** Return of an interrupted attempt's previous tree to the missing output path
 * @param root - Absolute output directory that does not exist
 * @param workspace - The only workspace holding a displaced tree for this output
 * @returns Restored destination or a refusal when the displaced tree cannot be verified
 * @throws {@link Error} Filesystem failure while verifying or restoring the tree
 */
async function restoreFromWorkspace(
  root: string,
  workspace: Workspace,
): Promise<Result<RecoveredOutput, PublicationFailure>> {
  const inspected = await inspectOutput(workspace.displaced);
  if (inspected.isErr())
    return Err(
      refusal(
        "output-interrupted",
        `An interrupted publication left a previous output that cannot be restored: ${inspected.error.message}`,
        [workspace.path],
      ),
    );
  await rename(workspace.displaced, root);
  const retainedPaths = await discardWorkspace(workspace, true);
  return Ok({ previous: inspected.value, retainedPaths });
}

/** Recovery of a previous output that an interrupted replacement displaced
 *
 * Replacement moves the previous tree into a sibling workspace and then moves the new tree
 * into place, so an interruption between the two moves leaves the output missing and the
 * previous tree in the workspace. The tree is restored only when it verifies as owned and
 * unmodified and exactly one workspace of this output holds one.
 * @param root - Absolute output directory that does not exist
 * @returns The restored destination, nothing to restore, or a refusal that names the leftovers
 * @throws {@link Error} Filesystem failure while inspecting or restoring the leftovers
 */
export async function restoreInterrupted(
  root: string,
): Promise<Result<RecoveredOutput, PublicationFailure>> {
  const workspaces = await displacedWorkspaces(root);
  const [only] = workspaces;
  if (only === undefined) return Ok({ previous: undefined, retainedPaths: [] });
  if (workspaces.length > 1)
    return Err(
      refusal(
        "output-interrupted",
        "Several interrupted publications left a previous output; keep one at the output path and remove the others",
        workspaces.map((workspace) => workspace.path),
      ),
    );
  return restoreFromWorkspace(root, only);
}
