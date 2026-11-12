import { resolve } from "node:path";
import { Err, Ok, type Result } from "ts-results-es";
import type { GeneratedFile } from "../model/contract-model.js";
import { filesystemMessage } from "./filesystem-error.js";
import { inspectOutput } from "./inspect-output.js";
import { describeArtifacts, sameOutput, type OutputManifest } from "./output-manifest.js";
import { refusal, type PublicationFailure, type PublicationReceipt } from "./publication-result.js";
import { restoreInterrupted, type RecoveredOutput } from "./recover-output.js";
import { replaceOutput } from "./replace-output.js";

export type { PublicationFailure, PublicationReceipt } from "./publication-result.js";

/** Destination state, restoring an interrupted replacement unless the call must not write
 * @param root - Absolute output directory
 * @param check - Read-only comparison instead of publication
 * @returns Verified destination, with a previous output restored from an interrupted replacement, or a refusal
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
 * @param root - Absolute output directory
 * @param files - Every required target after successful rendering
 * @param manifest - Complete identities of the generated files
 * @param check - Read-only comparison instead of publication
 * @returns Receipt, drift or refusal preserving the previous successful generation
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

/** All-target publication or read-only drift verification
 * @param directory - Emitter-owned output directory
 * @param files - Every required target after successful rendering
 * @param check - Read-only comparison instead of publication
 * @returns Completion or refusal preserving the previous successful generation
 * @throws {@link Error} A defect that is not a filesystem failure, which is never reported as output I/O
 */
export async function publishOutput(
  directory: string,
  files: readonly GeneratedFile[],
  check: boolean,
): Promise<Result<PublicationReceipt, PublicationFailure>> {
  const described = describeArtifacts(files);
  if (described.isErr()) return Err(described.error);
  try {
    return await publishVerified(resolve(directory), files, described.value, check);
  } catch (error) {
    return Err(refusal("output-io", filesystemMessage(error)));
  }
}
