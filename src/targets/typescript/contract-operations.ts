import type { Operation, Outcome } from "../../model/contract-model.js";
import { referenceType, useReaderName, type ContractContext } from "./contract-context.js";
import { useWritesBinding, writeUse } from "./contract-uses.js";
import { inputOf } from "./operation-plan.js";
import { operationStem } from "./operation-names.js";
import { docText, indent, lines, pascal, quote, tsdoc } from "./source-text.js";

/**
 * Union of the declared cases of one result path
 * @param context - Generation state
 * @param operation - Resolved operation
 * @param rejection - Whether to list expected rejections rather than successes
 * @returns Discriminated union type, `never` when the path has no case
 */
function caseUnion(context: ContractContext, operation: Operation, rejection: boolean): string {
  const members = operation.outcomes
    .filter((outcome) => outcome.rejection === rejection)
    .map(
      (outcome) =>
        `{ readonly case: ${quote(outcome.name)}${outcome.type ? `; readonly value: ${referenceType(context, outcome.type)}` : ""} }`,
    );
  return members.join(" | ") || "never";
}

/**
 * Binding codec of one outcome payload
 * @param context - Generation state
 * @param stem - Operation stem for derived names
 * @param outcome - Declared outcome
 * @returns Codec expression, the shared absent-payload codec for a void outcome
 */
function outcomeCodec(context: ContractContext, stem: string, outcome: Outcome): string {
  if (outcome.type === undefined) return "noValue";
  const reader = useReaderName(context, outcome.type, `${stem}${pascal(outcome.name)}`);
  const parameters = useWritesBinding(context, outcome.type) ? "value, binding" : "value";
  return `codec<${referenceType(context, outcome.type)}>(${reader}, (${parameters}) => ${writeUse(context, outcome.type, "value")})`;
}

/**
 * Operation-level types, provider acceptance and outcome codecs
 * @param context - Generation state
 * @param operation - Resolved operation
 * @returns Exported declarations of the operation
 */
export function operationSource(context: ContractContext, operation: Operation): string {
  const stem = operationStem(operation);
  const input = inputOf(context.byId, operation)!;
  const reader = context.readers.get(operation.input)!;
  const defaulted = input.fields.filter((field) => field.default !== undefined);
  const accepted = `${stem}AcceptedInput`;
  const effective =
    defaulted.length === 0
      ? input.name
      : `${input.name} & { ${defaulted.map((field) => `readonly ${quote(field.name)}: ${referenceType(context, field.type)}`).join("; ")} }`;
  const acceptSignature = `Result<Accepted<${accepted}>, readonly Violation[]>`;
  const outcomes = operation.outcomes.map(
    (outcome) => `${quote(outcome.name)}: ${outcomeCodec(context, stem, outcome)}`,
  );
  return lines(
    tsdoc("Provider input after omission-only default application"),
    `export type ${accepted} = ${effective};`,
    "",
    tsdoc("Exhaustive declared success"),
    `export type ${stem}Success = ${caseUnion(context, operation, false)};`,
    "",
    tsdoc("Declared expected rejection"),
    `export type ${stem}Rejection = ${caseUnion(context, operation, true)};`,
    "",
    tsdoc(
      `Provider-only acceptance of ${docText(operation.name, "operation")} parameters with omission defaults`,
      {
        params: [
          ["input", "Untrusted operation parameters"],
          ["mode", "Local or binding origin"],
        ],
        returns: "Effective immutable handler input or violations",
      },
    ),
    `export function accept${stem}(input: unknown, mode: "local" | WireBinding = "local"): ${acceptSignature} {`,
    `  return accept(input, mode, true, ${reader}).map((accepted) => accepted as Accepted<${accepted}>);`,
    "}",
    "",
    tsdoc(`Binding codecs of the ${operation.name} outcome payloads by outcome name`),
    `export const ${operation.name}Outcomes = Object.freeze({`,
    indent(outcomes.join(",\n")),
    "});",
  );
}
