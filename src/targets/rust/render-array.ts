import type { ArrayType } from "../../model/contract-model.js";
import { completeUse, optional } from "./checks.js";
import { decodeUse, encodeUse } from "./codec-use.js";
import { publicCodec } from "./codec-public.js";
import type { RustContext } from "./context.js";
import { doc, key } from "./naming.js";
import { useType } from "./storage.js";

/** Calls into the private completion shared by construction and decoding */
interface CompletionCalls {
  /** Cardinality statement for an element count expression, or an empty string */
  readonly items: (length: string) => string;
  /** Element statement for a borrowed element expression, or an empty string */
  readonly member: (member: string) => string;
}

/** Calls of the shared completion for a supplied or decoded element sequence
 * @param ctx - Generation context
 * @param type - Array declaration
 * @param path - Rust pointer expression of the array
 * @param state - Rust expression of the mutable violation sink
 * @returns Statement builders, each yielding an empty string when nothing restricts the array
 */
function completionCalls(
  ctx: RustContext,
  type: ArrayType,
  path: string,
  state: string,
): CompletionCalls {
  const id = key(type);
  const { minItems, maxItems } = type.constraints;
  const bounded = minItems !== undefined || maxItems !== undefined;
  const restricted = completeUse(ctx, type.element, "member", '""') !== "";
  return {
    items: (length) => (bounded ? `_check_${id}_items(${length}, ${path}, ${state});` : ""),
    member: (member) =>
      restricted ? `_check_${id}_member(${member}, index, ${path}, ${state});` : "",
  };
}

/** Private cardinality and element checks shared by construction and decoding
 * @param ctx - Generation context
 * @param type - Array declaration
 * @returns Rust private functions, with an empty string for a check nothing restricts
 */
function completion(ctx: RustContext, type: ArrayType): string {
  const id = key(type);
  const element = useType(ctx, type.element);
  const { minItems, maxItems } = type.constraints;
  const member = completeUse(ctx, type.element, "member", "&pointer(path, &index.to_string())");
  const items =
    minItems === undefined && maxItems === undefined
      ? ""
      : `/// Cardinality check of ${type.name} shared by construction and decoding
///
/// - length: number of supplied elements
/// - path: array pointer
/// - state: incomplete graph state
fn _check_${id}_items(length: usize, path: &str, state: &mut State) {
    check_items(length, ${optional(minItems)}, ${optional(maxItems)}, path, state);
}
`;
  if (member === "") return items;
  return `${items}/// Element check of ${type.name} shared by construction and decoding
///
/// - member: supplied element
/// - index: element position
/// - path: array pointer
/// - state: incomplete graph state
fn _check_${id}_member(member: &${element}, index: usize, path: &str, state: &mut State) {
    ${member}
}
`;
}

/** Public struct, constructor and accessors of an array
 * @param ctx - Generation context
 * @param type - Array declaration
 * @returns Rust declaration with its impl block
 */
function declaration(ctx: RustContext, type: ArrayType): string {
  const element = useType(ctx, type.element);
  const calls = completionCalls(ctx, type, '""', "&mut state");
  const each = calls.member("member");
  const steps = [
    calls.items("value.len()"),
    each === "" ? "" : `for (index, member) in value.iter().enumerate() { ${each} }`,
  ].filter(Boolean);
  const construct =
    steps.length === 0
      ? "State::default().finish(Some(Self(value)))"
      : `let mut state = State::default(); ${steps.join(" ")} state.finish(Some(Self(value)))`;
  return `${doc(type.description, "Immutable owned collection of accepted child values")}
#[derive(Debug, Clone, PartialEq)]
pub struct ${type.name}(Vec<${element}>);
impl ${type.name} {
/// Collection ownership transfer through the shared cardinality and element checks
///
/// - value: owned accepted child values
/// - Return: complete immutable array
/// # Errors
/// Cardinality or element use-site violations
pub fn try_new(value: Vec<${element}>) -> Result<Accepted<Self>, ValidationFailure> { ${construct} }
/// Shared immutable collection view
///
/// - self: validated collection
/// - Return: borrowed accepted elements
pub fn as_slice(&self) -> &[${element}] { &self.0 }
/// Consuming collection extraction
///
/// - self: validated collection
/// - Return: moved accepted elements
pub fn into_vec(self) -> Vec<${element}> { self.0 }
}`;
}

/** Single-pass array decoding through the shared element and cardinality checks
 * @param ctx - Generation context
 * @param type - Array declaration
 * @returns Rust private function
 */
function decoder(ctx: RustContext, type: ArrayType): string {
  const calls = completionCalls(ctx, type, "path", "state");
  const element = decodeUse(ctx, type.element, "value", "&pointer(path, &index.to_string())");
  return `/// Single-pass array boundary decoding
///
/// - value: incoming JSON
/// - binding: wire interpretation
/// - encoding: irrelevant collection encoding
/// - path: parent pointer
/// - state: incomplete graph state
/// - Return: completed collection candidate
fn _decode_${key(type)}(value: Value, binding: Binding, _encoding: Option<&str>, path: &str, state: &mut State) -> Option<${type.name}> {
    let Value::Array(value) = value else { state.reject(path, if value.is_null() { "null" } else { "type" }); return None; };
    ${calls.items("value.len()")}
    let mut result = Vec::with_capacity(value.len());
    for (index, value) in value.into_iter().enumerate() { if let Some(value) = ${element} { ${calls.member("&value")} result.push(value); } }
    Some(${type.name}(result))
}
`;
}

/** Borrowed collection encoding
 * @param ctx - Generation context
 * @param type - Array declaration
 * @returns Rust private function
 */
function encoder(ctx: RustContext, type: ArrayType): string {
  return `/// Borrowed collection encoding
///
/// - value: validated collection
/// - binding: wire interpretation
/// - encoding: irrelevant collection encoding
/// - Return: binding-local array
fn _encode_${key(type)}(value: &${type.name}, binding: Binding, _encoding: Option<&str>) -> Value {
    Value::Array(value.0.iter().map(|value| ${encodeUse(ctx, type.element, "value")}).collect())
}
`;
}

/** Array declaration with transferred collection ownership
 * @param ctx - Generation context
 * @param type - Array declaration
 * @returns Rust declaration and codecs
 */
export function renderArray(ctx: RustContext, type: ArrayType): string {
  return `${declaration(ctx, type)}
${completion(ctx, type)}${decoder(ctx, type)}${encoder(ctx, type)}${publicCodec(type)}`;
}
