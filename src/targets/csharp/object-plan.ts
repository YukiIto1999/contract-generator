import type { Field, ObjectType } from "../../model/contract-model.js";
import { useCheck, type UseCheck } from "./checks.js";
import type { CSharpContext } from "./context.js";
import type { DocParam } from "./docs.js";
import { name, pascal, pointerLiteral } from "./naming.js";

/** One object field with its generated names and shared use-site check */
export interface FieldPlan {
  /** Resolved field */
  readonly field: Field;
  /** Position in the canonical field order */
  readonly index: number;
  /** Absolute pointer literal of the member */
  readonly pointer: string;
  /** Escaped public property identifier */
  readonly property: string;
  /** Use-site check shared by every path that fills the member */
  readonly check: UseCheck;
}

/** Fields of an object with the names and checks that every generated member reuses
 * @param c - Target context
 * @param node - Resolved object
 * @returns One plan per field in canonical order
 */
export function planFields(c: CSharpContext, node: ObjectType): readonly FieldPlan[] {
  return node.fields.map((field, index) => ({
    field,
    index,
    pointer: pointerLiteral(field.wireName),
    property: c.property(node.id, field.name),
    check: useCheck(c, `Check${pascal(field.name)}`, field.type, `the ${field.wireName} member`),
  }));
}

/** Documented constructor parameters of an object
 * @param node - Resolved object
 * @returns Parameter descriptions in field order
 */
export function fieldDocs(node: ObjectType): readonly DocParam[] {
  return node.fields.map((field) => [
    field.name,
    field.description || `Value of the ${field.wireName} member`,
  ]);
}

/** Documented positional completion parameters of an object
 * @param plans - Field plans
 * @returns Parameter descriptions for f0, f1, ...
 */
export function positionalDocs(plans: readonly FieldPlan[]): readonly DocParam[] {
  return plans.map((plan) => [`f${plan.index}`, `Value of the ${plan.field.wireName} member`]);
}

/** Parameter types that let a caller hand over a collection that construction must own
 * @param c - Target context
 * @param node - Resolved object
 * @returns Enumerable parameter type by field name for required non-null array fields
 */
export function collectionParameters(
  c: CSharpContext,
  node: ObjectType,
): ReadonlyMap<string, string> {
  const entries: (readonly [string, string])[] = [];
  for (const field of node.fields) {
    const array = c.node(field.type.id);
    if (!field.optional && !field.type.nullable && array.kind === "array")
      entries.push([field.name, `IEnumerable<${c.use(array.element)}>`]);
  }
  return new Map(entries);
}

/** Parameter list of an object factory
 * @param c - Target context
 * @param node - Resolved object
 * @param replace - Fields whose public parameter type is replaced
 * @returns Escaped parameter declarations
 */
export function parameterList(
  c: CSharpContext,
  node: ObjectType,
  replace: ReadonlyMap<string, string> = new Map(),
): string {
  return node.fields.map((f) => `${replace.get(f.name) ?? c.field(f)} ${name(f.name)}`).join(", ");
}
