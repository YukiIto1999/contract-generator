import type { Origin } from "../../model/contract-model.js";

/** Records one source-addressed refusal
 * @param origin - Declaration position the refusal is addressed to
 * @param subject - Contract member whose meaning Rust cannot keep
 * @param reason - Actionable explanation
 */
export type Report = (origin: Origin, subject: string, reason: string) => void;
