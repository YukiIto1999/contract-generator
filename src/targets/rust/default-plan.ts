import type {
  ArrayType,
  Constant,
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
import { objectValue } from "./render-storage.js";

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

/** Child expansion scheduled before its parent expression */
export interface DefaultChild {
  readonly kind: "visit";
  readonly use: TypeUse;
  readonly constant: Constant;
  readonly slot: number;
}

/** Immediate storage expression with its ordered child expansions */
interface DefaultPlan {
  readonly expression: () => string;
  readonly children: DefaultChild[];
}

/** Object member initialization plan
 * @param type - Object storage declaration
 * @param constant - Exact default constant
 * @param next - First available child slot
 * @returns Member plan or undefined for missing required storage
 */
function planObject(type: ObjectType, constant: Constant, next: number): DefaultPlan | undefined {
  if (constant.kind !== "object") return undefined;
  const children: DefaultChild[] = [];
  const members: string[] = [];
  for (const field of type.fields) {
    const source = constant.properties[field.wireName] ?? field.default;
    if (source === undefined) {
      if (!field.optional) return undefined;
      members.push(`${snake(field.name)}: None`);
    } else {
      const child = next++;
      children.push({ kind: "visit", use: field.type, constant: source, slot: child });
      members.push(
        `${snake(field.name)}: ${field.optional ? `Some(default_${child})` : `default_${child}`}`,
      );
    }
  }
  return { expression: () => objectValue(type, members), children };
}

/** Array element initialization plan
 * @param type - Array storage declaration
 * @param constant - Exact default constant
 * @param next - First available child slot
 * @returns Element plan or undefined for another constant shape
 */
function planArray(type: ArrayType, constant: Constant, next: number): DefaultPlan | undefined {
  if (constant.kind !== "array") return undefined;
  const children: DefaultChild[] = [];
  const items = constant.items.map((item) => {
    const child = next++;
    children.push({ kind: "visit", use: type.element, constant: item, slot: child });
    return `default_${child}`;
  });
  return {
    expression: () => `${type.name}(Some(std::sync::Arc::new(vec![${items.join(", ")}])))`,
    children,
  };
}

/** Selected union payload initialization plan
 * @param type - Union storage declaration
 * @param constant - Exact default constant
 * @param next - Available payload slot
 * @returns Payload plan or undefined for an unknown discriminator
 */
function planUnion(type: UnionType, constant: Constant, next: number): DefaultPlan | undefined {
  if (constant.kind !== "object") return undefined;
  const tag = constant.properties[type.discriminator];
  const variant =
    tag?.kind === "string"
      ? type.variants.find((candidate) => candidate.tag === tag.value)
      : undefined;
  if (variant === undefined) return undefined;
  return {
    expression: () => `${type.name}(${type.name}Case::${variant.name}(default_${next}))`,
    children: [{ kind: "visit", use: variant.type, constant, slot: next }],
  };
}

/** Nonrecursive immediate storage expansion
 * @param ctx - Rendering context
 * @param use - Canonical use
 * @param constant - Exact non-null default
 * @param next - First available child slot
 * @returns Storage plan or undefined for an unbuildable shape
 */
export function planDefault(
  ctx: RustContext,
  use: TypeUse,
  constant: Constant,
  next: number,
): DefaultPlan | undefined {
  const type = node(ctx, use.id);
  switch (type.kind) {
    case "scalar": {
      const raw = scalarValue(type, constant);
      if (raw === undefined) return undefined;
      const role = type.role === null ? undefined : node(ctx, type.role).name;
      return { expression: () => (role === undefined ? raw : `${role}(${raw})`), children: [] };
    }
    case "enum": {
      const member = type.members.find((candidate) => sameLiteral(constant, candidate.value));
      if (member === undefined) return undefined;
      return { expression: () => `${type.name}::${member.name}`, children: [] };
    }
    case "literal":
      return sameLiteral(constant, type.value)
        ? { expression: () => `${type.name}(())`, children: [] }
        : undefined;
    case "object":
      return planObject(type, constant, next);
    case "array":
      return planArray(type, constant, next);
    case "union":
      return planUnion(type, constant, next);
  }
}
