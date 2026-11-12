import type { ObjectType } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name } from "./naming.js";
import { collectionParameters, fieldDocs, parameterList, type FieldPlan } from "./object-plan.js";

/** Public get-only property of one field
 * @param c - Target context
 * @param plan - Field plan
 * @returns Documented property
 */
function propertyDeclaration(c: CSharpContext, plan: FieldPlan): string {
  const { field } = plan;
  return lines(
    doc(field.description || `Value of the ${field.wireName} member`, [], undefined, {
      value: field.optional ? "Present when supplied, absent otherwise" : "Validated member value",
    }),
    `public ${c.field(field)} ${plan.property} { get; }`,
  );
}

/** Factory overload that owns a caller-supplied collection
 * @param c - Target context
 * @param node - Resolved object
 * @returns Overload delegating to the codec, or nothing without collection fields
 */
function ownedFactory(c: CSharpContext, node: ObjectType): string {
  const replace = collectionParameters(c, node);
  if (replace.size === 0) return "";
  return lines(
    doc(
      "Owned caller-collection construction",
      fieldDocs(node),
      "Immutable object or positioned violations",
    ),
    `public static Result<Accepted<${c.type(node.id)}>, ContractFailure> Create(${parameterList(c, node, replace)}) => ${c.codec(node.id)}.Create(${node.fields.map((f) => name(f.name)).join(", ")});`,
  );
}

/** Immutable object class with private completion
 * @param c - Target context
 * @param node - Resolved object
 * @param plans - Field plans
 * @returns Class declaration
 */
export function objectDeclaration(
  c: CSharpContext,
  node: ObjectType,
  plans: readonly FieldPlan[],
): string {
  const t = c.type(node.id);
  const parameters = parameterList(c, node);
  const names = node.fields.map((f) => name(f.name)).join(", ");
  const assignments = plans.map((p) => `this.${p.property} = ${name(p.field.name)};`).join(" ");
  return lines(
    doc(node.description || `Immutable ${node.name} contract value`),
    `public sealed class ${name(node.name)} {`,
    ...plans.map((plan) => propertyDeclaration(c, plan)),
    doc("Validated object completion", fieldDocs(node)),
    `private ${name(node.name)}(${parameters}) { ${assignments} }`,
    doc(
      "Private completion shared by construction and decoding",
      fieldDocs(node),
      "Immutable object",
    ),
    `internal static ${t} Complete(${parameters}) => new(${names});`,
    doc(
      "Constrained local object construction",
      fieldDocs(node),
      "Object or positioned violations",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Create(${parameters}) => ${c.codec(node.id)}.Create(${names});`,
    ownedFactory(c, node),
    "}",
  );
}
