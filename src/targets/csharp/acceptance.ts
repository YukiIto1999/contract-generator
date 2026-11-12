import type { ObjectType, Operation } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name, pascal } from "./naming.js";
import { applyMethod } from "./provider-defaults.js";

/** Operation input object
 * @param c - Target context
 * @param operation - Operation
 * @returns Resolved input object
 * @throws {@link Error} A normalized operation whose input is not an object
 */
export function inputOf(c: CSharpContext, operation: Operation): ObjectType {
  const input = c.node(operation.input);
  if (input.kind !== "object") throw new Error("Operation input must be an object");
  return input;
}

/** Whether the operation input itself has a field that provider acceptance defaults
 * @param input - Operation input object
 * @returns Presence of a defaulted top-level field
 */
function hasTopLevelDefault(input: ObjectType): boolean {
  return input.fields.some((field) => field.default !== undefined);
}

/** Identifier of the strengthened input type that handlers receive
 * @param operation - Operation
 * @returns Escaped type identifier
 */
export function acceptedInputName(operation: Operation): string {
  return name(pascal(operation.name) + "AcceptedInput");
}

/** Public type of the input that a handler receives
 * @param c - Target context
 * @param operation - Operation
 * @returns The input itself unless a top-level default strengthens a member's presence
 */
export function acceptedType(c: CSharpContext, operation: Operation): string {
  return hasTopLevelDefault(inputOf(c, operation))
    ? c.qualified(pascal(operation.name) + "AcceptedInput")
    : c.type(operation.input);
}

/** Handler input whose defaulted top-level members are present
 * @param c - Target context
 * @param operation - Operation
 * @returns Class declaration, or nothing when no top-level default exists
 */
function acceptedInputClass(c: CSharpContext, operation: Operation): string {
  const input = inputOf(c, operation);
  if (!hasTopLevelDefault(input)) return "";
  const self = acceptedInputName(operation);
  const parameters = input.fields.map((f) => `${c.field(f, true)} ${name(f.name)}`).join(", ");
  const docs = input.fields.map(
    (f) => [f.name, f.description || `Value of the ${f.wireName} member`] as const,
  );
  return lines(
    doc(`Provider-accepted ${operation.name} input whose defaulted members are always present`),
    `public sealed class ${self} {`,
    ...input.fields.map((f) =>
      lines(
        doc(f.description || `Value of the ${f.wireName} member`, [], undefined, {
          value: "Provider-accepted member value",
        }),
        `public ${c.field(f, true)} ${c.property(input.id, f.name)} { get; }`,
      ),
    ),
    doc("Effective input completion", docs),
    `private ${self}(${parameters}) { ${input.fields.map((f) => `this.${c.property(input.id, f.name)} = ${name(f.name)};`).join(" ")} }`,
    doc("Private completion shared by every provider acceptance path", docs, "Effective input"),
    `internal static ${acceptedType(c, operation)} Complete(${parameters}) => new(${input.fields.map((f) => name(f.name)).join(", ")});`,
    "}",
  );
}

/** Effective input assembled from the input with defaults applied
 * @param c - Target context
 * @param operation - Operation
 * @param needs - Nodes that acceptance rebuilds
 * @returns Return statement of the acceptance method
 */
function acceptedResult(
  c: CSharpContext,
  operation: Operation,
  needs: ReadonlySet<string>,
): string {
  const input = inputOf(c, operation);
  const applied = `ProviderDefaults.${applyMethod(c, input.id)}(input)`;
  if (!needs.has(input.id)) return `return c.Finish(input);`;
  if (!hasTopLevelDefault(input)) return `return c.Finish(${applied});`;
  const members = input.fields.map((field) => {
    const source = `applied.${c.property(input.id, field.name)}`;
    return field.default !== undefined && field.optional ? `${source}.Value` : source;
  });
  return lines(
    `var applied = ${applied};`,
    `return c.Finish(${acceptedType(c, operation)}.Complete(${members.join(", ")}));`,
  );
}

/** Shared direct and transport provider acceptance of one operation input
 * @param c - Target context
 * @param operation - Operation
 * @param needs - Nodes that acceptance rebuilds
 * @returns Static class
 */
function acceptanceClass(
  c: CSharpContext,
  operation: Operation,
  needs: ReadonlySet<string>,
): string {
  const input = inputOf(c, operation);
  const effective = acceptedType(c, operation);
  return lines(
    doc(`Provider acceptance of the ${operation.name} input shared by direct and transport calls`),
    `public static class ${name(pascal(operation.name) + "Acceptance")} {`,
    doc(
      "Provider acceptance with defaults applied below every omitted member",
      [["input", "Local or decoded input"]],
      "Effective input or positioned violations",
    ),
    `public static Result<Accepted<${effective}>, ContractFailure> Accept(${c.type(input.id)} input) {`,
    `var c = new ReadContext(); ${c.codec(input.id)}.Check(input, c, "");`,
    `if (!c.IsValid) return c.Finish<${effective}>(default!);`,
    acceptedResult(c, operation, needs),
    "}",
    "}",
  );
}

/** Provider acceptance declarations of every operation
 * @param c - Target context
 * @param needs - Nodes that acceptance rebuilds
 * @returns Handler input classes and acceptance classes
 */
export function renderAcceptance(c: CSharpContext, needs: ReadonlySet<string>): string {
  return lines(
    ...c.model.operations.map((operation) =>
      lines(acceptedInputClass(c, operation), acceptanceClass(c, operation, needs)),
    ),
  );
}
