/** Completed publication with any cleanup obligation made explicit */
export interface PublicationReceipt {
  /** Replacement of the previously published tree */
  readonly changed: boolean;
  /** Owned temporary paths retained after a cleanup failure */
  readonly retainedPaths: readonly string[];
}

/** Refusal or filesystem failure without a successful partial update */
export interface PublicationFailure {
  /** Stable publication failure category */
  readonly code:
    | "output-drift"
    | "output-not-owned"
    | "output-modified"
    | "output-interrupted"
    | "output-io"
    | "invalid-artifact";
  /** Actionable explanation without artifact contents */
  readonly message: string;
  /** Preserved paths requiring recovery or cleanup */
  readonly recoveryPaths: readonly string[];
}

/** Failure that names the paths a person must inspect or clean up
 * @param code - Publication failure category
 * @param message - Human-facing refusal reason
 * @param recoveryPaths - Preserved paths requiring recovery or cleanup
 * @returns Refusal carrying its recovery obligations
 */
export function refusal(
  code: PublicationFailure["code"],
  message: string,
  recoveryPaths: readonly string[] = [],
): PublicationFailure {
  return { code, message, recoveryPaths };
}
