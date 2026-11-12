import { Err, Ok, type Result } from "ts-results-es";
import type { GeneratedFile } from "../model/contract-model.js";
import { filesystemMessage, isFilesystemError } from "./filesystem-error.js";
import { inspectOutput } from "./inspect-output.js";
import { describeArtifacts, sameOutput, type OutputManifest } from "./output-manifest.js";
import {
  acquirePublicationOwnership,
  canonicalOutputPath,
  inspectPublicationOwner,
} from "./publication-ownership.js";
import { refusal, type PublicationFailure, type PublicationReceipt } from "./publication-result.js";
import { discardEmptyDirectory } from "./publication-workspace.js";
import { restoreInterrupted, type RecoveredOutput } from "./recover-output.js";
import { replaceOutput } from "./replace-output.js";

export type { PublicationFailure, PublicationReceipt } from "./publication-result.js";

/** Destination state under exclusive ownership or read-only observation
 * @param root - Canonical-parent output directory
 * @param check - Read-only comparison without recovery
 * @returns Verified destination with any exclusively recovered previous output
 * @throws {@link Error} Filesystem failure while reading or restoring the destination
 */
async function currentOutput(
  root: string,
  check: boolean,
): Promise<Result<RecoveredOutput, PublicationFailure>> {
  const inspected = await inspectOutput(root);
  if (inspected.isErr()) return Err(inspected.error);
  if (inspected.value !== undefined || check)
    return Ok({ previous: inspected.value, retainedPaths: [] });
  return restoreInterrupted(root);
}

/** Comparison against the verified destination followed by replacement unless checking
 * @param root - Canonical-parent output directory
 * @param files - Every required target after successful rendering
 * @param manifest - Complete identities of the generated files
 * @param check - Read-only comparison without recovery
 * @returns Receipt or refusal with preservation of the previous successful generation
 * @throws {@link Error} Filesystem failure while reading or replacing the destination
 */
async function publishVerified(
  root: string,
  files: readonly GeneratedFile[],
  manifest: OutputManifest,
  check: boolean,
): Promise<Result<PublicationReceipt, PublicationFailure>> {
  const current = await currentOutput(root, check);
  if (current.isErr()) return Err(current.error);
  const { previous, retainedPaths: inherited } = current.value;
  if (sameOutput(previous?.manifest, manifest))
    return Ok({ changed: false, retainedPaths: inherited });
  if (check)
    return Err(
      refusal("output-drift", "Generated artifacts differ from the current contract: " + root),
    );
  const replaced = await replaceOutput(root, previous, files, manifest);
  return replaced
    .map((receipt) => ({ ...receipt, retainedPaths: [...inherited, ...receipt.retainedPaths] }))
    .mapErr((failure) => ({ ...failure, recoveryPaths: [...inherited, ...failure.recoveryPaths] }));
}

/** Read-only comparison guarded on both sides against cooperative publication
 * @param root - Canonical-parent output directory
 * @param files - Complete generated artifacts
 * @param manifest - Complete artifact identities
 * @returns Point-in-time comparison or ownership conflict without any writes
 * @throws {@link Error} Filesystem failure or a non-filesystem defect during inspection
 */
async function checkOutput(
  root: string,
  files: readonly GeneratedFile[],
  manifest: OutputManifest,
): Promise<Result<PublicationReceipt, PublicationFailure>> {
  const owner = await inspectPublicationOwner(root);
  if (owner !== undefined) return Err(owner);
  try {
    const compared = await publishVerified(root, files, manifest, true);
    const acquired = await inspectPublicationOwner(root);
    return acquired === undefined ? compared : Err(acquired);
  } catch (error) {
    if (!isFilesystemError(error)) throw error;
    const acquired = await inspectPublicationOwner(root);
    if (acquired !== undefined) return Err(acquired);
    throw error;
  }
}

/** Publication scoped to one immediately acquired cross-process owner
 * @param root - Canonical-parent output directory
 * @param files - Complete generated artifacts
 * @param manifest - Complete artifact identities
 * @returns Publication or refusal with any ownership cleanup obligation
 * @throws {@link Error} Filesystem failure or a non-filesystem defect during publication
 */
async function publishExclusively(
  root: string,
  files: readonly GeneratedFile[],
  manifest: OutputManifest,
): Promise<Result<PublicationReceipt, PublicationFailure>> {
  const acquired = await acquirePublicationOwnership(root);
  if (acquired.isErr()) return Err(acquired.error);
  let retainedPaths: readonly string[] = [];
  let published: Result<PublicationReceipt, PublicationFailure>;
  try {
    published = await publishVerified(root, files, manifest, false);
  } catch (error) {
    published = Err(refusal("output-io", filesystemMessage(error)));
  } finally {
    retainedPaths = await discardEmptyDirectory(acquired.value);
  }
  return published
    .map((receipt) => ({ ...receipt, retainedPaths: [...receipt.retainedPaths, ...retainedPaths] }))
    .mapErr((failure) => ({
      ...failure,
      recoveryPaths: [...failure.recoveryPaths, ...retainedPaths],
    }));
}

/** All-target publication with immediate cooperative ownership conflict
 *
 * Check mode performs no writes or recovery and refuses observed ownership
 * Interrupted ownership requires independently verified manual release before recovery
 * Replacement has a gap between renames with the previous tree retained for rollback
 * @param directory - Emitter-owned output directory without an output symbolic link
 * @param files - Every required target after successful rendering
 * @param check - Read-only comparison without ownership acquisition
 * @returns Completion or typed refusal without stealing active or abandoned ownership
 * @throws {@link Error} A non-filesystem defect without translation to output I/O
 */
export async function publishOutput(
  directory: string,
  files: readonly GeneratedFile[],
  check: boolean,
): Promise<Result<PublicationReceipt, PublicationFailure>> {
  const described = describeArtifacts(files);
  if (described.isErr()) return Err(described.error);
  try {
    const root = await canonicalOutputPath(directory);
    return await (check
      ? checkOutput(root, files, described.value)
      : publishExclusively(root, files, described.value));
  } catch (error) {
    return Err(refusal("output-io", filesystemMessage(error)));
  }
}
