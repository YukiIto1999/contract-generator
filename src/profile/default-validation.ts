import type { DiagnosticTarget } from "@typespec/compiler";
import type {
  ArrayType,
  Constant,
  ContractType,
  Literal,
  ObjectType,
  TypeUse,
  UnionType,
} from "../model/contract-model.js";
import { checkConstantConstraints } from "./constant-constraints.js";
import { intersectConstraints } from "./constraint-intersection.js";
import type { IssueSink } from "./issue-sink.js";
import { compareNumbers } from "./numeric-bounds.js";
import { validScalar } from "./scalar-domain.js";

/** Graph and declaration shared by every step of one default validation */
interface DefaultSite {
  /** Complete normalized graph */
  readonly types: ReadonlyMap<string, ContractType>;
  /** Declaration owning the complete default */
  readonly target: DiagnosticTarget;
}

/**
 * Full default validation after recursive type normalization
 * @param value - Exact normalized constant
 * @param use - Resolved value type with presence-independent nullability
 * @param types - Complete normalized graph
 * @param target - Declaration owning the default
 * @param issue - Source-addressed failure accumulator
 */
export function validateDefault(
  value: Constant,
  use: TypeUse,
  types: ReadonlyMap<string, ContractType>,
  target: DiagnosticTarget,
  issue: IssueSink,
): void {
  for (const reason of validateConstant(value, use, { types, target }, ""))
    issue("invalid-default", target, reason);
}

/**
 * Recursive constant validation without provider default substitution
 * @param value - Constant at the current location
 * @param use - Declared value restrictions
 * @param site - Graph and declaration owning the complete default
 * @param path - Constant property path
 * @returns Every known violation in the constant
 */
function validateConstant(
  value: Constant,
  use: TypeUse,
  site: DefaultSite,
  path: string,
): string[] {
  const at = path || "/";
  if (value.kind === "null" && use.nullable) return [];
  const type = site.types.get(use.id);
  if (!type) return [`${at}: default type could not be resolved`];
  const reasons: string[] = [];
  const constraints = intersectConstraints(
    "constraints" in type ? type.constraints : {},
    use.constraints,
    site.target,
    (_code, _target, reason) => reasons.push(reason),
  );
  reasons.push(...checkConstantConstraints(value, constraints, at));
  reasons.push(...validateShape(value, type, site, path));
  return reasons;
}

/**
 * Structural validation of a constant against one kind of node
 * @param value - Constant at the current location
 * @param type - Resolved node of the declared use
 * @param site - Graph and declaration owning the complete default
 * @param path - Constant property path
 * @returns Violations of the node's own shape
 */
function validateShape(
  value: Constant,
  type: ContractType,
  site: DefaultSite,
  path: string,
): string[] {
  const at = path || "/";
  switch (type.kind) {
    case "literal":
      return sameLiteral(value, type.value) ? [] : [`${at}: default violates literal`];
    case "enum":
      return type.members.some((member) => sameLiteral(value, member.value))
        ? []
        : [`${at}: default is outside the enumeration`];
    case "scalar":
      return validScalar(value, type) ? [] : [`${at}: default violates ${type.scalar}`];
    case "array":
      return validateArray(value, type, site, path);
    case "object":
      return validateObject(value, type, site, path);
    case "union":
      return validateUnion(value, type, site, path);
  }
}

/**
 * Item-wise validation of an array constant
 * @param value - Constant at the current location
 * @param type - Resolved array node
 * @param site - Graph and declaration owning the complete default
 * @param path - Constant property path
 * @returns Violations of the array and its items
 */
function validateArray(
  value: Constant,
  type: ArrayType,
  site: DefaultSite,
  path: string,
): string[] {
  if (value.kind !== "array") return [`${path || "/"}: default must be an array`];
  return value.items.flatMap((item, index) =>
    validateConstant(item, type.element, site, `${path}/${index}`),
  );
}

/**
 * Field-wise validation of an object constant with required and unknown members detected
 * @param value - Constant at the current location
 * @param type - Resolved object node
 * @param site - Graph and declaration owning the complete default
 * @param path - Constant property path
 * @returns Violations of the object and its members
 */
function validateObject(
  value: Constant,
  type: ObjectType,
  site: DefaultSite,
  path: string,
): string[] {
  const at = path || "/";
  if (value.kind !== "object") return [`${at}: default must be an object`];
  const reasons: string[] = [];
  for (const field of type.fields) {
    const item = value.properties[field.wireName];
    const fieldPath = `${path}/${field.wireName.replaceAll("~", "~0").replaceAll("/", "~1")}`;
    if (item !== undefined) reasons.push(...validateConstant(item, field.type, site, fieldPath));
    else if (!field.optional) reasons.push(`${fieldPath}: required default field is missing`);
  }
  for (const name of Object.keys(value.properties)) {
    if (!type.fields.some((field) => field.wireName === name))
      reasons.push(`${at}: unknown default field ${JSON.stringify(name)}`);
  }
  return reasons;
}

/**
 * Variant selection by discriminator followed by validation as the selected variant
 * @param value - Constant at the current location
 * @param type - Resolved union node
 * @param site - Graph and declaration owning the complete default
 * @param path - Constant property path
 * @returns Violations of the selection or of the selected variant payload
 */
function validateUnion(
  value: Constant,
  type: UnionType,
  site: DefaultSite,
  path: string,
): string[] {
  const at = path || "/";
  if (value.kind !== "object") return [`${at}: default must be a tagged object`];
  const tag = value.properties[type.discriminator];
  const variant =
    tag?.kind === "string"
      ? type.variants.find((candidate) => candidate.tag === tag.value)
      : undefined;
  if (!variant) return [`${at}: default has an unknown or missing discriminator`];
  return validateConstant(value, variant.type, site, path);
}

/**
 * Primitive literal equality with exact numeric comparison
 * @param value - Candidate constant
 * @param expected - Declared literal
 * @returns Exact primitive value equality
 */
function sameLiteral(value: Constant, expected: Literal): boolean {
  if (value.kind !== expected.kind) return false;
  switch (expected.kind) {
    case "null":
      return true;
    case "number":
      return value.kind === "number" && compareNumbers(value.text, expected.text) === 0;
    case "string":
      return value.kind === "string" && value.value === expected.value;
    case "boolean":
      return value.kind === "boolean" && value.value === expected.value;
  }
}
