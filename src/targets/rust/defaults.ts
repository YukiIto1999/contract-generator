import type {
  Constant,
  Field,
  Literal,
  ObjectType,
  ScalarType,
  TypeUse,
  UnionType,
} from "../../model/contract-model.js";
import { node, type RustContext } from "./context.js";
import { exactInteger, jsonNumber, sameNumber } from "./numbers.js";
import { quote, snake } from "./naming.js";
import { exactNumeric } from "./storage.js";

/** Nesting bound that stops expansion of a default whose fields default recursively */
const maxDepth = 32;

/** Inclusive native range of each integer storage */
const integerRange: Readonly<Record<string, readonly [bigint, bigint]>> = {
  int32: [-(2n ** 31n), 2n ** 31n - 1n],
  int64: [-(2n ** 63n), 2n ** 63n - 1n],
  uint64: [0n, 2n ** 64n - 1n],
};

/** Exact numeric token storage
 * @param constant - Number constant
 * @returns Rust expression of the exact token, or undefined for another constant or a non-JSON spelling
 */
function exactNumber(constant: Constant): string | undefined {
  return constant.kind === "number" && jsonNumber(constant.text)
    ? `ExactNumber(Number::from_string_unchecked(${quote(constant.text)}.into()))`
    : undefined;
}

/** Native integer literal within the storage range
 * @param type - Integer scalar
 * @param constant - Number constant
 * @returns Typed Rust literal, or undefined when the constant is not an integer of that range
 */
function nativeInteger(type: ScalarType, constant: Constant): string | undefined {
  const range = integerRange[type.scalar];
  const value = constant.kind === "number" ? exactInteger(constant.text) : undefined;
  if (range === undefined || value === undefined || value < range[0] || value > range[1])
    return undefined;
  const suffix = type.scalar === "uint64" ? "u64" : type.scalar === "int64" ? "i64" : "i32";
  return `${value}_${suffix}`;
}

/** Native floating-point literal that stays finite in its storage
 * @param type - Floating-point scalar
 * @param constant - Number constant
 * @returns Typed Rust literal, or undefined when the constant overflows the storage
 */
function nativeFloat(type: ScalarType, constant: Constant): string | undefined {
  if (constant.kind !== "number" || !jsonNumber(constant.text)) return undefined;
  const number = Number(constant.text);
  const stored = type.scalar === "float32" ? Math.fround(number) : number;
  return Number.isFinite(stored)
    ? `${constant.text}_${type.scalar === "float32" ? "f32" : "f64"}`
    : undefined;
}

/** Owned byte storage from an array of byte values
 * @param constant - Array constant
 * @returns Rust expression, or undefined when an item is not a byte
 */
function bytesValue(constant: Constant): string | undefined {
  if (constant.kind !== "array") return undefined;
  const bytes = constant.items.map((item) =>
    item.kind === "number" ? exactInteger(item.text) : undefined,
  );
  if (bytes.some((byte) => byte === undefined || byte < 0n || byte > 255n)) return undefined;
  return bytes.length === 0
    ? "bytes::Bytes::new()"
    : `bytes::Bytes::from_static(&[${bytes.map((byte) => `${byte}_u8`).join(", ")}])`;
}

/** Raw storage value of a scalar constant
 * @param type - Resolved scalar
 * @param constant - Exact constant
 * @returns Rust expression of the storage type, or undefined when the constant has another shape
 */
function scalarValue(type: ScalarType, constant: Constant): string | undefined {
  if (exactNumeric(type)) return exactNumber(constant);
  switch (type.scalar) {
    case "boolean":
      return constant.kind === "boolean" ? String(constant.value) : undefined;
    case "string":
    case "offsetDateTime":
    case "utcDateTime":
    case "plainDate":
    case "plainTime":
    case "duration":
      return constant.kind === "string" ? `${quote(constant.value)}.to_owned()` : undefined;
    case "int32":
    case "int64":
    case "uint64":
      return nativeInteger(type, constant);
    case "float32":
    case "float64":
      return nativeFloat(type, constant);
    case "integer":
    case "decimal":
      return exactNumber(constant);
    case "bytes":
      return bytesValue(constant);
  }
}

/** Exact primitive equality between a constant and a declared literal
 * @param constant - Default constant
 * @param literal - Declared literal
 * @returns Whether both denote the same value
 */
function sameLiteral(constant: Constant, literal: Literal): boolean {
  switch (literal.kind) {
    case "null":
      return constant.kind === "null";
    case "string":
      return constant.kind === "string" && constant.value === literal.value;
    case "boolean":
      return constant.kind === "boolean" && constant.value === literal.value;
    case "number":
      return constant.kind === "number" && sameNumber(constant.text, literal.text);
  }
}

/** Value of a field from its explicit constant or its own default
 * @param ctx - Rendering context
 * @param field - Object field
 * @param given - Explicit constant for the field
 * @param depth - Current expansion depth
 * @returns Rust expression of the field storage, or undefined when it cannot be built
 */
function buildField(
  ctx: RustContext,
  field: Field,
  given: Constant | undefined,
  depth: number,
): string | undefined {
  const source = given ?? field.default;
  if (source === undefined) return field.optional ? "None" : undefined;
  const value = buildUse(ctx, field.type, source, depth + 1);
  return field.optional && value !== undefined ? `Some(${value})` : value;
}

/** Object value whose omitted optional fields take their own defaults
 * @param ctx - Rendering context
 * @param type - Object declaration
 * @param constant - Object constant keyed by wire name
 * @param depth - Current expansion depth
 * @returns Struct expression, or undefined when a member cannot be built
 */
function buildObject(
  ctx: RustContext,
  type: ObjectType,
  constant: Constant,
  depth: number,
): string | undefined {
  if (constant.kind !== "object") return undefined;
  const members: string[] = [];
  for (const field of type.fields) {
    const value = buildField(ctx, field, constant.properties[field.wireName], depth);
    if (value === undefined) return undefined;
    members.push(`${snake(field.name)}: ${value}`);
  }
  return `${type.name} { ${members.join(", ")} }`;
}

/** Union value selected by the discriminator of the constant
 * @param ctx - Rendering context
 * @param type - Union declaration
 * @param constant - Tagged object constant
 * @param depth - Current expansion depth
 * @returns Union expression, or undefined without a known tag or payload
 */
function buildUnion(
  ctx: RustContext,
  type: UnionType,
  constant: Constant,
  depth: number,
): string | undefined {
  if (constant.kind !== "object") return undefined;
  const tag = constant.properties[type.discriminator];
  const variant =
    tag?.kind === "string"
      ? type.variants.find((candidate) => candidate.tag === tag.value)
      : undefined;
  const payload =
    variant === undefined ? undefined : buildUse(ctx, variant.type, constant, depth + 1);
  return variant === undefined || payload === undefined
    ? undefined
    : `${type.name}(${type.name}Case::${variant.name}(${payload}))`;
}

/** Value of a declaration without any run-time decoding
 * @param ctx - Rendering context
 * @param use - Use selecting the declaration
 * @param constant - Exact constant
 * @param depth - Current expansion depth
 * @returns Rust expression of the declaration, or undefined when the constant does not fit it
 */
function buildNode(
  ctx: RustContext,
  use: TypeUse,
  constant: Constant,
  depth: number,
): string | undefined {
  const type = node(ctx, use.id);
  switch (type.kind) {
    case "scalar": {
      const raw = scalarValue(type, constant);
      const role = type.role === null ? undefined : node(ctx, type.role).name;
      return raw === undefined || role === undefined ? raw : `${role}(${raw})`;
    }
    case "object":
      return buildObject(ctx, type, constant, depth);
    case "union":
      return buildUnion(ctx, type, constant, depth);
    case "enum": {
      const member = type.members.find((candidate) => sameLiteral(constant, candidate.value));
      return member === undefined ? undefined : `${type.name}::${member.name}`;
    }
    case "literal":
      return sameLiteral(constant, type.value) ? `${type.name}(())` : undefined;
    case "array": {
      if (constant.kind !== "array") return undefined;
      const items = constant.items.map((item) => buildUse(ctx, type.element, item, depth + 1));
      return items.includes(undefined) ? undefined : `${type.name}(vec![${items.join(", ")}])`;
    }
  }
}

/** Use value with its nullable and indirect representation
 * @param ctx - Rendering context
 * @param use - Resolved use
 * @param constant - Exact constant
 * @param depth - Current expansion depth
 * @returns Rust expression of the use type, or undefined when the constant does not fit it
 */
function buildUse(
  ctx: RustContext,
  use: TypeUse,
  constant: Constant,
  depth: number,
): string | undefined {
  if (depth > maxDepth) return undefined;
  if (constant.kind === "null") return use.nullable ? "None" : undefined;
  const inner = buildNode(ctx, use, constant, depth);
  if (inner === undefined) return undefined;
  const owned = ctx.boxed.has(use) ? `Box::new(${inner})` : inner;
  return use.nullable ? `Some(${owned})` : owned;
}

/** Whether a field default can be built into storage without any run-time failure
 * @param ctx - Rendering context
 * @param field - Field carrying the default
 * @returns True when the default is absent or fits its declared storage
 */
export function buildable(ctx: RustContext, field: Field): boolean {
  return field.default === undefined || buildUse(ctx, field.type, field.default, 0) !== undefined;
}

/** Typed default whose construction cannot fail at run time
 * @param ctx - Rendering context
 * @param field - Optional field with a default
 * @returns Rust expression of the field use type
 * @throws Error when the default does not fit its storage, which `buildable` rules out before rendering
 */
export function defaultValue(ctx: RustContext, field: Field): string {
  const value =
    field.default === undefined ? undefined : buildUse(ctx, field.type, field.default, 0);
  if (value === undefined) throw new Error(`Unbuildable default for ${field.name}`);
  return value;
}
