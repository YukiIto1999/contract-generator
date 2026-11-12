import type { ScalarType } from "../../model/contract-model.js";
import { exactNumeric } from "./storage.js";

/** Rust expressions converting one scalar between its wire token and its storage */
export interface ScalarCodec {
  /** Expression yielding the storage Option from `value`, `encoding`, `path` and `state` */
  readonly decode: string;
  /** Expression yielding the wire token from the borrowed storage `value` and `encoding` */
  readonly encode: string;
  /** Whether the wire representation depends on the selected encoding */
  readonly encodingAware: boolean;
}

/** Textual scalars share one codec because their wire token is always a JSON string */
const textual: ScalarCodec = {
  decode: "text(value, path, state)",
  encode: "Value::String(value.clone())",
  encodingAware: false,
};

/** Numbers retained as exact tokens in either representation */
const exactToken: ScalarCodec = {
  decode: `number(value, encoding == "string", path, state).map(ExactNumber)`,
  encode: `if encoding == "string" { Value::String(value.as_str().into()) } else { Value::Number(value.0.clone()) }`,
  encodingAware: true,
};

/** Boolean token or its string spelling */
const boolean: ScalarCodec = {
  decode: `if encoding == "string" { text(value, path, state).and_then(|value| match value.as_str() { "true" => Some(true), "false" => Some(false), _ => { state.reject(path, "format"); None } }) } else { match value { Value::Bool(value) => Some(value), other => { state.reject(path, if other.is_null() { "null" } else { "type" }); None } } }`,
  encode: `if encoding == "string" { Value::String(value.to_string()) } else { Value::Bool(*value) }`,
  encodingAware: true,
};

/** Binary token in the binding-local base64 alphabet */
const bytes: ScalarCodec = {
  decode: `text(value, path, state).and_then(|value| match base64_engine(encoding).decode(&value) { Ok(value) => Some(bytes::Bytes::from(value)), Err(_) => { state.reject(path, "format"); None } })`,
  encode: "Value::String(base64_engine(encoding).encode(value))",
  encodingAware: true,
};

/** Native integer storage decoded from an exact token without binary floating-point conversion
 * @param type - Integer scalar
 * @returns Codec of the native storage
 */
function integer(type: ScalarType): ScalarCodec {
  const parse = type.scalar === "uint64" ? "as_u64" : "as_i64";
  const narrow = type.scalar === "int32" ? ".and_then(|number| i32::try_from(number).ok())" : "";
  return {
    decode: `number(value, encoding == "string", path, state).and_then(|number| { let value = number.${parse}().or_else(|| integer_token(&number)?.parse().ok())${narrow}; if value.is_none() { state.reject(path, "type"); } value })`,
    encode: `if encoding == "string" { Value::String(value.to_string()) } else { Value::Number(Number::from(*value)) }`,
    encodingAware: true,
  };
}

/** Native floating-point storage decoded from a finite number
 * @param type - Floating-point scalar
 * @returns Codec of the native storage
 */
function float(type: ScalarType): ScalarCodec {
  const single = type.scalar === "float32";
  const narrow = single ? ".map(|value| value as f32)" : "";
  const widen = single ? "f64::from(*value)" : "*value";
  return {
    decode: `number(value, encoding == "string", path, state).and_then(|number| { let value = number.as_f64()${narrow}; if value.is_none() { state.reject(path, "type"); } value })`,
    encode: `if encoding == "string" { Value::String(value.to_string()) } else { finite_number(${widen}) }`,
    encodingAware: true,
  };
}

/** Wire conversion of a scalar meaning
 * @param type - Resolved scalar
 * @returns Codec expressions for its storage
 */
export function scalarCodec(type: ScalarType): ScalarCodec {
  if (exactNumeric(type)) return exactToken;
  switch (type.scalar) {
    case "boolean":
      return boolean;
    case "int32":
    case "int64":
    case "uint64":
      return integer(type);
    case "float32":
    case "float64":
      return float(type);
    case "bytes":
      return bytes;
    case "integer":
    case "decimal":
      return exactToken;
    case "string":
    case "offsetDateTime":
    case "utcDateTime":
    case "plainDate":
    case "plainTime":
    case "duration":
      return textual;
  }
}
