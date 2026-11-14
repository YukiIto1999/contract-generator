import type {
  ContractType,
  Field,
  Literal,
  ScalarKind,
  ScalarType,
  TypeUse,
} from "../../model/contract-model.js";
import { defaulted } from "./accepting.js";
import { node, type RustContext } from "./context.js";

/** Scalar meanings whose JSON representation is a number token */
const numberKinds: Readonly<Partial<Record<ScalarKind, true>>> = {
  int32: true,
  int64: true,
  uint64: true,
  float32: true,
  float64: true,
  integer: true,
  decimal: true,
};

/** Rust storage of each scalar meaning without lexical retention */
const nativeStorage: Readonly<Record<ScalarKind, string>> = {
  string: "String",
  boolean: "bool",
  int32: "i32",
  int64: "i64",
  uint64: "u64",
  integer: "ExactNumber",
  decimal: "ExactNumber",
  float32: "f32",
  float64: "f64",
  bytes: "bytes::Bytes",
  offsetDateTime: "String",
  utcDateTime: "String",
  plainDate: "String",
  plainTime: "String",
  duration: "String",
};

/** Storage as an exact JSON number token rather than a native primitive
 * @param type - Resolved scalar
 * @returns True for arbitrary-precision kinds and for numbers that retain their source spelling
 */
export function exactNumeric(type: ScalarType): boolean {
  return (
    type.scalar === "integer" ||
    type.scalar === "decimal" ||
    (type.preserveLexical && numberKinds[type.scalar] === true)
  );
}

/** Scalar storage preserving the complete declared representation
 * @param type - Resolved contract declaration
 * @returns Rust storage expression
 */
export function storage(type: ContractType): string {
  if (type.kind !== "scalar") return type.name;
  return exactNumeric(type) ? "ExactNumber" : nativeStorage[type.scalar];
}

/** Nullable canonical handle representation independent of field presence
 * @param ctx - Rendering context
 * @param use - Resolved use
 * @returns Rust type expression
 */
export function useType(ctx: RustContext, use: TypeUse): string {
  const name = node(ctx, use.id).name;
  return use.nullable ? `Option<${name}>` : name;
}

/** Field representation retaining omission independently from null
 * @param ctx - Rendering context
 * @param field - Contract field
 * @param effective - Provider default presence guarantee
 * @returns Rust type expression
 */
export function fieldType(ctx: RustContext, field: Field, effective = false): string {
  const type = useType(ctx, field.type);
  return field.optional && !(effective && defaulted(field)) ? `Option<${type}>` : type;
}

/** Exact JSON literal text without numeric conversion
 * @param value - Normalized literal
 * @returns JSON source
 */
export function literalJson(value: Literal): string {
  return value.kind === "number"
    ? value.text
    : value.kind === "null"
      ? "null"
      : JSON.stringify(value.value);
}
