import type { GeneratedFile } from "../../../src/model/contract-model.js";
import type {
  PublicationFailure,
  PublicationReceipt,
} from "../../../src/publication/publication-result.js";

/** Filesystem transition paused by the child process until its parent responds */
export type PublicationBarrier =
  | "before-stage"
  | "before-reserve"
  | "before-install"
  | "before-displace"
  | "after-displace"
  | "during-check";

/** Inputs to an independent publication process */
export interface PublicationProcessOptions {
  /** Destination shared by cooperating publishers */
  readonly output: string;
  /** Complete generated artifacts for this publisher */
  readonly files: readonly GeneratedFile[];
  /** Read-only comparison without publication */
  readonly check: boolean;
  /** Optional deterministic pause at an actual filesystem transition */
  readonly barrier?: PublicationBarrier;
}

/** Observed completion across the process boundary */
export type PublicationProcessOutcome =
  | { readonly kind: "published"; readonly receipt: PublicationReceipt }
  | { readonly kind: "refused"; readonly failure: PublicationFailure }
  | { readonly kind: "defect"; readonly message: string; readonly code: unknown };

/** IPC protocol with an explicit barrier before completion */
export type PublicationProcessMessage =
  | { readonly kind: "paused"; readonly path: string }
  | PublicationProcessOutcome;
