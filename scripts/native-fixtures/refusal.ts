import { Err } from "ts-results-es";

/** Expected refusal to prepare native fixture sources, reported only at the entry point */
export interface Refusal {
  /** Stable refusal category */
  readonly code:
    | "unsafe-work-directory"
    | "unsafe-destination"
    | "unowned-destination"
    | "unowned-entry"
    | "missing-source-lock"
    | "missing-environment"
    | "source-hash-mismatch"
    | "missing-project"
    | "unsupported-entry";
  /** Actionable explanation naming the path or input that was refused */
  readonly message: string;
}

/** Failed step of the preparation
 * @param code - Refusal category
 * @param message - Actionable explanation naming the path or input that was refused
 * @returns Failure result carrying the refusal
 */
export function refuse(code: Refusal["code"], message: string): Err<Refusal> {
  return Err({ code, message });
}
