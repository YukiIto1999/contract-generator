import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  auditReceiptFile,
  bounded,
  parseReceipt,
  restoredPackagesBelow,
  unauditedPackages,
  type Receipt,
} from "../../../scripts/native-fixtures/package-audit.js";

/** Receipt that `npm run audit:native` writes for the offline native builds */
const receiptPath = fileURLToPath(new URL(`../../../${auditReceiptFile}`, import.meta.url));
/** Preparation that audits the packages online */
const auditCommand = "npm run audit:native";
/** Largest number of unaudited packages that a failure names */
const reportedPackages = 20;

/** Receipt of the online package audit, or the reason that it is unusable */
type ReceiptState =
  | { /** Audited packages */ readonly receipt: Receipt }
  | { /** Prerequisite failure naming the preparation */ readonly problem: string };

/** Receipt of the online package audit
 * @returns The receipt, or the problem with it
 */
function readReceipt(): ReceiptState {
  const guidance = `run \`${auditCommand}\` with network access`;
  if (!existsSync(receiptPath))
    return { problem: `${auditReceiptFile} does not exist (${guidance})` };
  const receipt = parseReceipt(readFileSync(receiptPath, "utf8"));
  return receipt === undefined
    ? { problem: `${auditReceiptFile} is not a package audit receipt (${guidance})` }
    : { receipt };
}

/** Prerequisite of every offline native build
 * @returns The problem with the package audit receipt, or nothing when it is usable
 */
export function auditReceiptProblem(): string | undefined {
  const state = readReceipt();
  return "problem" in state ? state.problem : undefined;
}

/** Refusal of a restore that resolved a package which the preparation did not audit
 * @param artifactsRoot - SDK artifacts directory that holds the restore assets of one native build
 * @throws {@link Error} A missing receipt, or restored packages that the receipt does not cover with the same archive hash
 */
export function requireAuditedPackages(artifactsRoot: string): void {
  const state = readReceipt();
  if ("problem" in state) throw new Error(state.problem);
  const { auditedAt, packages } = state.receipt;
  const unaudited = unauditedPackages(restoredPackagesBelow(artifactsRoot), packages);
  if (unaudited.length > 0)
    throw new Error(
      `The restore resolved NuGet packages that the audit of ${auditedAt} did not cover; run \`${auditCommand}\` with network access:\n${bounded(unaudited, reportedPackages)}`,
    );
}
