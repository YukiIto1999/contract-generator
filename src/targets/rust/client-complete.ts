import type { Operation, Outcome } from "../../model/contract-model.js";
import { snake, stem } from "./naming.js";

/** Typed outcome completion after prior wire identification
 * @param operation - Canonical operation
 * @param outcome - Selected declared result
 * @param payload - Rust payload expression
 * @param gateway - Rust condition under which a payload mismatch is a relay communication failure
 * @param raw - Whether the payload is the raw response body
 * @returns Result completion statements
 */
export function complete(
  operation: Operation,
  outcome: Outcome,
  payload: string,
  gateway: string,
  raw: boolean,
): string {
  const op = snake(operation.name);
  const name = stem(operation);
  const carried = outcome.type ? "(accepted.value)" : "";
  const result = outcome.rejection
    ? `Err(OperationFailure::Rejected(Accepted { value: ${name}Rejection::${outcome.name}${carried}, diagnostics: accepted.diagnostics }))`
    : `Ok(Accepted { value: ${name}Success::${outcome.name}${carried}, diagnostics: accepted.diagnostics })`;
  if (!outcome.type) return `let accepted = Accepted { value: (), diagnostics: vec![] }; ${result}`;
  const decode = raw
    ? `decode_${op}_${snake(outcome.name)}_bytes(${payload})`
    : `decode_${op}_${snake(outcome.name)}(${payload}, binding)`;
  return `let accepted = match ${decode} { Ok(accepted) => accepted, Err(_) if ${gateway} => return Err(OperationFailure::Communication), Err(_) => panic!("response payload violates the selected declared result") }; ${result}`;
}
