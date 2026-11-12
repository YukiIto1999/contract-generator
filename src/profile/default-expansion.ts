import type { DiagnosticTarget } from "@typespec/compiler";
import type { Constant, ContractType, Field, TypeUse } from "../model/contract-model.js";
import type { IssueSink } from "./issue-sink.js";

/** Complete normalized graph consulted while expanding defaults */
type TypeTable = ReadonlyMap<string, ContractType>;

/**
 * Provider default expansion termination without constructing an accepted input
 * @param value - Exact normalized default constant
 * @param use - Resolved declared value type
 * @param types - Complete normalized graph including nested field defaults
 * @param target - Declaration owning the default
 * @param issue - Source-addressed failure accumulator
 */
export function validateDefaultExpansion(
  value: Constant,
  use: TypeUse,
  types: TypeTable,
  target: DiagnosticTarget,
  issue: IssueSink,
): void {
  if (!terminates(value, use, types, new Set()))
    issue(
      "nonterminating-default",
      target,
      "Provider acceptance would recursively expand the same field default without reaching a finite input",
    );
}

/**
 * Finite default expansion over the concrete constant and missing nested fields
 * @param constant - Explicit value or substituted default
 * @param reference - Resolved declared type at this location
 * @param types - Complete normalized graph
 * @param active - Field defaults currently being expanded
 * @returns Termination of all provider substitutions below this location
 */
function terminates(
  constant: Constant,
  reference: TypeUse,
  types: TypeTable,
  active: Set<Field>,
): boolean {
  if (constant.kind === "null") return true;
  const type = types.get(reference.id);
  if (type?.kind === "array" && constant.kind === "array")
    return constant.items.every((item) => terminates(item, type.element, types, active));
  if (type?.kind === "union" && constant.kind === "object") {
    const tag = constant.properties[type.discriminator];
    const variant =
      tag?.kind === "string"
        ? type.variants.find((candidate) => candidate.tag === tag.value)
        : undefined;
    return !variant || terminates(constant, variant.type, types, active);
  }
  if (type?.kind !== "object" || constant.kind !== "object") return true;
  const members = constant.properties;
  return type.fields.every((field) => fieldTerminates(field, members, types, active));
}

/**
 * Termination of one field of an object constant, substituting its default when omitted
 * @param field - Field of the object
 * @param members - Members of the object constant being expanded, by wire name
 * @param types - Complete normalized graph
 * @param active - Field defaults currently being expanded
 * @returns Termination of the explicit member or of the substituted default
 */
function fieldTerminates(
  field: Field,
  members: Readonly<Record<string, Constant>>,
  types: TypeTable,
  active: Set<Field>,
): boolean {
  const child = members[field.wireName];
  if (child !== undefined) return terminates(child, field.type, types, active);
  if (field.default === undefined) return true;
  if (active.has(field)) return false;
  active.add(field);
  const finite = terminates(field.default, field.type, types, active);
  active.delete(field);
  return finite;
}
