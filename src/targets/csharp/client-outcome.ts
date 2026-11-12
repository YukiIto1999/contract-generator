import type { Operation, Outcome } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { lines, name, pascal, quote } from "./naming.js";
import { familyName, opName } from "./outcome-codecs.js";

/** Result expression type of a client operation
 * @param operation - Operation
 * @returns Closed result type with the success and failure families
 */
function resultType(operation: Operation): string {
  return `Result<${opName(operation, "Success")}, ${opName(operation, "Failure")}>`;
}

/** Communication failure returned to the caller
 * @param operation - Operation
 * @param reason - Stable host-visible reason
 * @returns Return statement
 */
function communicationReturn(operation: Operation, reason: string): string {
  return `return new ${resultType(operation)}.Failed(new ${opName(operation, "Failure")}.Communication(new(${quote(reason)})));`;
}

/** Mismatch classification of a relayed or direct response
 * @param operation - Operation
 * @param reason - Communication reason used when an intermediary produced the response
 * @param defect - Defect message used when the peer broke the contract itself
 * @param gateway - Whether the status identifies a relaying intermediary
 * @returns Statements that return or throw
 */
export function mismatch(
  operation: Operation,
  reason: string,
  defect: string,
  gateway = true,
): string {
  const defective = `throw new InvalidOperationException(${quote(defect)});`;
  return gateway
    ? `if (gateway) ${communicationReturn(operation, reason)} ${defective}`
    : defective;
}

/** Return of a completed outcome on its own path
 * @param operation - Operation
 * @param outcome - Outcome
 * @returns Return statement over `accepted`
 */
function completedReturn(operation: Operation, outcome: Outcome): string {
  const result = resultType(operation);
  const failure = opName(operation, "Failure");
  return outcome.rejection
    ? `return new ${result}.Failed(new ${failure}.Declared(accepted.Value.Value));`
    : `return new ${result}.Succeeded(accepted.Value.Value);`;
}

/** Outcome completion from payload text of the selected result
 * @param operation - Operation
 * @param outcome - Selected outcome
 * @param body - Payload JSON text expression
 * @param binding - Binding name
 * @param gateway - Whether a payload mismatch may come from a relaying intermediary
 * @returns Statements that return the typed result
 */
export function decodeOutcome(
  operation: Operation,
  outcome: Outcome,
  body: string,
  binding: "http" | "ipc",
  gateway: boolean,
): string {
  const family = familyName(operation, outcome);
  if (!outcome.type)
    return lines(
      `var completed = ${family}.${name(pascal(outcome.name))}.Create();`,
      `if (completed is not Result<Accepted<${family}>, ContractFailure>.Succeeded accepted) throw new InvalidOperationException("Invalid generated outcome completion");`,
      completedReturn(operation, outcome),
    );
  return lines(
    `var completed = ${opName(operation, "OutcomeCodecs")}.Decode${outcome.name}Result(${body}, ${quote(binding)});`,
    `if (completed is not Result<Accepted<${family}>, ContractFailure>.Succeeded accepted) { ${mismatch(operation, "gateway-response-mismatch", "Response payload contract mismatch", gateway)} }`,
    completedReturn(operation, outcome),
  );
}

/** Binary response completion without a JSON round trip
 * @param c - Target context
 * @param operation - Operation
 * @param outcome - Selected binary outcome
 * @returns Statements that return the typed result
 */
export function binaryOutcome(c: CSharpContext, operation: Operation, outcome: Outcome): string {
  const use = outcome.type!;
  const node = c.node(use.id);
  const family = familyName(operation, outcome);
  const role = node.kind === "scalar" && node.role !== null;
  const invalid = `{ ${mismatch(operation, "gateway-body-mismatch", "Invalid binary response")} }`;
  return lines(
    role && `var rawValue = ${c.codec(use.id)}.Create(ImmutableArray.CreateRange(bytes));`,
    role &&
      `if (rawValue is not Result<Accepted<${c.type(use.id)}>, ContractFailure>.Succeeded raw) ${invalid}`,
    `var completed = ${family}.${name(pascal(outcome.name))}.Create(${role ? "raw.Value.Value" : "ImmutableArray.CreateRange(bytes)"});`,
    `if (completed is not Result<Accepted<${family}>, ContractFailure>.Succeeded accepted) ${invalid}`,
    completedReturn(operation, outcome),
  );
}
