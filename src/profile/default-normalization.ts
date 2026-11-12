import type {
  Constant,
  ContractType,
  Literal,
  ObjectType,
  ScalarType,
  TypeUse,
  UnionType,
  Variant,
} from "../model/contract-model.js";
import { compareNumbers, isIntegral, plainNumber } from "./numeric-bounds.js";
import { integerKinds } from "./scalars.js";

/** Complete normalized graph consulted while rewriting a constant */
type TypeTable = ReadonlyMap<string, ContractType>;

/**
 * Logical default value in the canonical form every target builds from
 * @param value - Compiler constant using source property names and the author's numeral spelling
 * @param use - Normalized declared type
 * @param types - Complete normalized graph
 * @returns Constant with JSON property names, plain integer digits and the declared literal spelling
 */
export function normalizeDefault(value: Constant, use: TypeUse, types: TypeTable): Constant {
  const type = types.get(use.id);
  if (type === undefined || value.kind === "null") return value;
  switch (type.kind) {
    case "scalar":
      return normalizeScalar(value, type);
    case "literal":
      return declaredSpelling(value, [type.value]);
    case "enum":
      return declaredSpelling(
        value,
        type.members.map((member) => member.value),
      );
    case "array":
      return value.kind === "array"
        ? {
            kind: "array",
            items: value.items.map((item) => normalizeDefault(item, type.element, types)),
          }
        : value;
    case "union":
      return normalizeUnion(value, type, types);
    case "object":
      return normalizeObject(value, type, types);
  }
}

/**
 * Plain integer digits for whole-number scalars and byte values
 * @param value - Constant written for a scalar
 * @param type - Resolved scalar semantics
 * @returns Constant whose whole numbers carry no exponent, fraction or redundant digits
 */
function normalizeScalar(value: Constant, type: ScalarType): Constant {
  if (value.kind === "number" && integerKinds.includes(type.scalar) && isIntegral(value.text))
    return { kind: "number", text: plainNumber(value.text) };
  if (value.kind === "array" && type.scalar === "bytes")
    return {
      kind: "array",
      items: value.items.map((item) =>
        item.kind === "number" && isIntegral(item.text)
          ? { kind: "number", text: plainNumber(item.text) }
          : item,
      ),
    };
  return value;
}

/**
 * Numeric spelling of the declared literal for an equal number
 * @param value - Constant written for a literal or enumeration
 * @param declared - Permitted literals
 * @returns The declared literal equal to a number constant, otherwise the constant unchanged
 */
function declaredSpelling(value: Constant, declared: readonly Literal[]): Constant {
  if (value.kind !== "number") return value;
  const text = value.text;
  return (
    declared.find(
      (literal) => literal.kind === "number" && compareNumbers(literal.text, text) === 0,
    ) ?? value
  );
}

/**
 * Variant payload normalization selected by the discriminator value
 * @param value - Constant written for a union
 * @param type - Resolved union
 * @param types - Complete normalized graph
 * @returns Constant normalized as the selected variant, or unchanged when no variant is selected
 */
function normalizeUnion(value: Constant, type: UnionType, types: TypeTable): Constant {
  if (value.kind !== "object") return value;
  for (const variant of type.variants) {
    const tag = value.properties[sourceDiscriminator(variant, type, types)];
    if (tag?.kind === "string" && tag.value === variant.tag)
      return normalizeDefault(value, variant.type, types);
  }
  return value;
}

/**
 * Source property name under which a variant payload declares the discriminator
 * @param variant - Union variant
 * @param type - Resolved union
 * @param types - Complete normalized graph
 * @returns Canonical field name, or the wire discriminator when the payload does not declare it
 */
function sourceDiscriminator(variant: Variant, type: UnionType, types: TypeTable): string {
  const payload = types.get(variant.type.id);
  const field =
    payload?.kind === "object"
      ? payload.fields.find((candidate) => candidate.wireName === type.discriminator)
      : undefined;
  return field?.name ?? type.discriminator;
}

/**
 * Source property names mapped to JSON names with member values normalized
 * @param value - Constant written for an object
 * @param type - Resolved object
 * @param types - Complete normalized graph
 * @returns Object constant keyed by wire names
 */
function normalizeObject(value: Constant, type: ObjectType, types: TypeTable): Constant {
  if (value.kind !== "object") return value;
  const properties: Record<string, Constant> = Object.create(null) as Record<string, Constant>;
  for (const [name, child] of Object.entries(value.properties)) {
    const field = type.fields.find((candidate) => candidate.name === name);
    properties[field?.wireName ?? name] = field
      ? normalizeDefault(child, field.type, types)
      : child;
  }
  return { kind: "object", properties };
}
