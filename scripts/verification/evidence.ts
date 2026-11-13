import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Check } from "./inputs.ts";

/** Local successful verification receipt */
export interface Receipt {
  /** Receipt format generation */
  readonly version: 1;
  /** Check whose pass the receipt records */
  readonly check: Check;
  /** Complete input fingerprint observed before and after the pass */
  readonly key: string;
  /** Observed result of the completed check */
  readonly result: "passed";
  /** Wrapped check command without the caller's per-session temporary bind */
  readonly command: readonly string[];
  /** Files whose bytes entered the fingerprint */
  readonly inputs: readonly string[];
  /** Non-secret tool and platform identity */
  readonly environment: unknown;
  /** Installed npm dependency fingerprint */
  readonly dependencies: string;
  /** Completion instant in ISO 8601 */
  readonly completedAt: string;
  /** Elapsed seconds of the check command */
  readonly seconds: number;
  /** Passed native test identities or no tests for a static check */
  readonly tests: unknown;
  /** Emitted build output fingerprint or no persistent output */
  readonly output: string | null;
}

/** Trusted-local receipt match without executing a check
 * @param value - Previously persisted unknown JSON
 * @param check - Required check
 * @param key - Current complete input fingerprint
 * @param output - Current build output fingerprint
 * @returns Matching successful receipt
 */
export function reusableReceipt(
  value: unknown,
  check: Check,
  key: string,
  output: string | null,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const receipt = value as Partial<Receipt>;
  return (
    receipt.version === 1 &&
    receipt.result === "passed" &&
    receipt.check === check &&
    receipt.key === key &&
    receipt.output === output &&
    typeof receipt.seconds === "number" &&
    Number.isFinite(receipt.seconds) &&
    receipt.seconds >= 0
  );
}

/** Best-effort receipt loading with invalid evidence treated as absent
 * @param directory - Ignored local evidence directory
 * @param check - Required check
 * @returns Decoded receipt or absent evidence
 */
export function readReceipt(directory: string, check: Check): unknown {
  const path = join(directory, `${check}.json`);
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Removal of evidence before a fresh attempt
 * @param directory - Ignored local evidence directory
 * @param check - Check about to execute
 */
export function invalidateReceipt(directory: string, check: Check): void {
  rmSync(join(directory, `${check}.json`), { force: true });
}

/** Atomic publication of successful local evidence
 * @param directory - Ignored local evidence directory
 * @param receipt - Complete observed pass evidence
 */
export function saveReceipt(directory: string, receipt: Receipt): void {
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${receipt.check}.json`);
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

/** Fresh check attempt that publishes pass evidence only after a completed pass
 * @param directory - Ignored local evidence directory
 * @param check - Check about to execute
 * @param execute - Complete check execution resolving to its observed pass receipt
 * @returns Published pass receipt
 * @throws {@link Error} Failure or interruption of the execution, with no pass evidence left for the check
 */
export async function attemptCheck(
  directory: string,
  check: Check,
  execute: () => Promise<Receipt>,
): Promise<Receipt> {
  invalidateReceipt(directory, check);
  const receipt = await execute();
  if (receipt.check !== check)
    throw new Error(`Receipt for ${receipt.check} cannot publish ${check}`);
  saveReceipt(directory, receipt);
  return receipt;
}
