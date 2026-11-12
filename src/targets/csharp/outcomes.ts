import type { Operation, Outcome } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { renderHttpRequestCodec } from "./http-request-codec.js";
import { lines, name, pascal } from "./naming.js";
import { opName, renderOutcomeCodecs } from "./outcome-codecs.js";

/** Closed variant of one outcome
 * @param c - Target context
 * @param operation - Operation
 * @param outcome - Outcome
 * @param family - Escaped family identifier
 * @returns Nested record declaration
 */
function outcomeVariant(
  c: CSharpContext,
  operation: Operation,
  outcome: Outcome,
  family: string,
): string {
  const variant = name(pascal(outcome.name));
  const payload = outcome.type ? c.use(outcome.type) : undefined;
  const parameters = payload === undefined ? [] : [["value", "Candidate payload"] as const];
  const argument = payload === undefined ? "" : `${payload} value`;
  const supplied = payload === undefined ? "" : "value";
  const validate =
    payload === undefined
      ? ""
      : lines(
          `var checkedValue = ${opName(operation, "OutcomeCodecs")}.Validate${outcome.name}(value);`,
          `if (checkedValue is Result<Accepted<${payload}>, ContractFailure>.Failed failed) return new Result<Accepted<${family}>, ContractFailure>.Failed(failed.Failure);`,
        );
  return lines(
    doc(outcome.description || `Canonical ${outcome.name} result`),
    `public sealed record ${variant} : ${family} {`,
    payload !== undefined &&
      doc("Immutable outcome payload", [], undefined, { value: "Validated contract payload" }),
    payload !== undefined && `public ${payload} Value { get; }`,
    doc("Validated outcome completion", parameters),
    `private ${variant}(${argument}) { ${payload === undefined ? "" : "Value = value;"} }`,
    doc("Typed outcome construction", parameters, "Outcome or positioned violations"),
    `public static Result<Accepted<${family}>, ContractFailure> Create(${argument}) {`,
    validate,
    `return new Result<Accepted<${family}>, ContractFailure>.Succeeded(new(new ${variant}(${supplied}), ImmutableArray<UnknownProperty>.Empty));`,
    "}",
    doc("Validated decoded outcome completion", parameters, "Completed outcome"),
    `internal static ${family} Complete(${argument}) => new ${variant}(${supplied});`,
    "}",
  );
}

/** Closed success or rejection family
 * @param c - Target context
 * @param operation - Operation
 * @param rejection - Declared failure partition
 * @returns Closed outcome hierarchy
 */
function outcomeFamily(c: CSharpContext, operation: Operation, rejection: boolean): string {
  const family = opName(operation, rejection ? "Rejection" : "Success");
  return lines(
    doc(
      rejection
        ? `Declared rejection paths of ${operation.name}`
        : `Distinct success paths of ${operation.name}`,
    ),
    `[ClosedUnion] public abstract record ${family} {`,
    doc("Closed outcome completion"),
    `private ${family}() { }`,
    ...operation.outcomes
      .filter((outcome) => outcome.rejection === rejection)
      .map((outcome) => outcomeVariant(c, operation, outcome, family)),
    "}",
  );
}

/** Expected failures of one operation
 * @param operation - Operation
 * @returns Closed failure hierarchy
 */
function failureFamily(operation: Operation): string {
  const failure = opName(operation, "Failure");
  return lines(
    doc(`Typed expected failures of ${operation.name}`),
    `[ClosedUnion] public abstract record ${failure} {`,
    doc("Closed operation failure completion"),
    `private ${failure}() { }`,
    doc("Provider input rejection", [["Failure", "Positioned violations of the rejected input"]]),
    `public sealed record InvalidInput(ContractFailure Failure) : ${failure};`,
    doc("Declared operation rejection", [["Rejection", "Rejection that the operation declares"]]),
    `public sealed record Declared(${opName(operation, "Rejection")} Rejection) : ${failure};`,
    doc("Communication that could not get or finish a response", [
      ["Failure", "Host-classified communication failure"],
    ]),
    `public sealed record Communication(CommunicationFailure Failure) : ${failure};`,
    "}",
  );
}

/** Pure public operation result contracts
 * @param c - Target context
 * @returns Closed outcomes, failures and binding codecs
 */
export function renderOperationTypes(c: CSharpContext): string {
  return lines(
    doc("Expected communication failure that an injected transport reports"),
    "public sealed record CommunicationFailure {",
    doc("Communication failure classification", [], undefined, {
      value: "Host-owned stable reason",
    }),
    "public string Reason { get; }",
    doc("Expected communication failure construction", [["reason", "Host-owned stable reason"]]),
    "public CommunicationFailure(string reason) { Reason = reason; }",
    "}",
    ...c.model.operations.map((operation) =>
      lines(
        outcomeFamily(c, operation, false),
        outcomeFamily(c, operation, true),
        failureFamily(operation),
        renderOutcomeCodecs(c, operation),
        renderHttpRequestCodec(c, operation),
      ),
    ),
  );
}
