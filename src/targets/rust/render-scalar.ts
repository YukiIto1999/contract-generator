import type { ScalarType } from "../../model/contract-model.js";
import { asserted, scalarChecks } from "./checks.js";
import { publicCodec } from "./codec-public.js";
import { node, type RustContext } from "./context.js";
import { doc, key, quote } from "./naming.js";
import { scalarCodec, type ScalarCodec } from "./scalar-codec.js";
import { storage } from "./storage.js";

/** Names and expressions shared by the Rust items of one scalar declaration */
interface ScalarPlan {
  /** Helper suffix of the declaration */
  readonly id: string;
  /** Rust storage type */
  readonly raw: string;
  /** Nominal role constructor, absent for an ordinary scalar */
  readonly role: string | undefined;
  /** Base validation statements over the borrowed `value` and `path` */
  readonly checks: string;
  /** Wire conversion of the storage */
  readonly codec: ScalarCodec;
}

/** Items of one scalar declaration derived once
 * @param ctx - Generation context
 * @param type - Resolved scalar
 * @returns Shared names and expressions
 */
function plan(ctx: RustContext, type: ScalarType): ScalarPlan {
  return {
    id: key(type),
    raw: storage(type),
    role: type.role === null ? undefined : node(ctx, type.role).name,
    checks: scalarChecks(type, "value", "path"),
    codec: scalarCodec(type),
  };
}

/** Effective binding-local encoding expression
 * @param type - Resolved scalar
 * @returns Rust expression of the encoding name
 */
function encodingChoice(type: ScalarType): string {
  return `encoding.unwrap_or(match binding { Binding::Http => ${quote(type.encodings.http)}, Binding::Ipc => ${quote(type.encodings.ipc)} })`;
}

/** Constructor body validating owned storage through the shared base checks
 * @param p - Scalar plan
 * @returns Rust expression yielding the accepted value or its violations
 */
function construct(p: ScalarPlan): string {
  const wrapped = p.role === undefined ? "value" : `${p.role}(value)`;
  return p.checks === ""
    ? `State::default().finish(Some(${wrapped}))`
    : `let mut state = State::default(); ${p.role === undefined ? "" : `let value = ${wrapped};`} _check_${p.id}(&value, 0, &mut state); state.finish(Some(value))`;
}

/** Public type and constructor of a scalar declaration
 * @param type - Resolved scalar
 * @param p - Scalar plan
 * @returns Role struct with accessors, or an alias with its constructor function
 */
function declaration(type: ScalarType, p: ScalarPlan): string {
  const head = doc(type.description, `Validated ${type.scalar} contract representation`);
  if (type.role !== type.id)
    return `${head}
pub type ${type.name} = ${p.role ?? p.raw};
/// Owned constrained scalar construction
///
/// - value: caller-owned storage
/// - Return: validated scalar
/// # Errors
/// Normal scalar violations
pub fn try_new_${p.id}(value: ${p.raw}) -> Result<Accepted<${type.name}>, ValidationFailure> { ${construct(p)} }`;
  return `${head}
#[derive(Debug, Clone, PartialEq)]
pub struct ${type.name}(${p.raw});
impl ${type.name} {
/// Owned constrained role construction
///
/// - value: caller-owned storage
/// - Return: validated role value
/// # Errors
/// Normal scalar violations
pub fn try_new(value: ${p.raw}) -> Result<Accepted<Self>, ValidationFailure> { ${construct(p)} }
/// Borrowed immutable role storage
///
/// - self: accepted role
/// - Return: shared storage reference
pub fn value(&self) -> &${p.raw} { &self.0 }
/// Consuming role storage extraction
///
/// - self: accepted role
/// - Return: moved owned storage
pub fn into_value(self) -> ${p.raw} { self.0 }
}`;
}

/** Representation decoding of a scalar without validation
 * @param type - Resolved scalar
 * @param p - Scalar plan
 * @param name - Function name prefix
 * @returns Rust private function
 */
function parseFunction(type: ScalarType, p: ScalarPlan, name: string): string {
  const aware = p.codec.encodingAware;
  const body = p.role === undefined ? p.codec.decode : `(${p.codec.decode}).map(${p.role})`;
  return `/// Internal scalar representation decoding without validation
///
/// - value: owned JSON token
/// - binding: wire selection
/// - encoding: use-site override
/// - path: diagnostic pointer
/// - state: incomplete graph state
/// - Return: storage candidate in its role
fn ${name}${p.id}(json: &mut _Json, node: usize, ${aware ? "binding" : "_binding"}: Binding, ${aware ? "encoding" : "_encoding"}: Option<&str>, path: _Path, state: &mut State) -> Option<${type.name}> {
    let value = json.take(node);
    ${aware ? `let encoding = ${encodingChoice(type)};` : ""}
    ${body}
}
`;
}

/** Shared base checks and the validating decoder of a scalar with restrictions
 * @param type - Resolved scalar
 * @param p - Scalar plan
 * @returns Rust private functions, or an empty string when nothing restricts the scalar
 */
function checkedFunctions(type: ScalarType, p: ScalarPlan): string {
  if (p.checks === "") return "";
  return `/// Base value checks of ${type.name} shared by construction and decoding
///
/// - value: storage candidate in its role
/// - path: diagnostic pointer
/// - state: incomplete graph state
fn _check_${p.id}(value: &${type.name}, path: _Path, state: &mut State) {
    ${p.checks}
}
/// Internal scalar decoding with validation
///
/// - value: owned JSON token
/// - binding: wire selection
/// - encoding: use-site override
/// - path: diagnostic pointer
/// - state: incomplete graph state
/// - Return: validated candidate
fn _decode_${p.id}(json: &mut _Json, node: usize, binding: Binding, encoding: Option<&str>, path: _Path, state: &mut State) -> Option<${type.name}> {
    let value = _parse_${p.id}(json, node, binding, encoding, path, state)?;
    _check_${p.id}(&value, path, state);
    Some(value)
}
`;
}

/** Wire encoding of accepted scalar storage
 * @param type - Resolved scalar
 * @param p - Scalar plan
 * @returns Rust private function
 */
function encodeFunction(type: ScalarType, p: ScalarPlan): string {
  const aware = p.codec.encodingAware;
  return `/// Internal scalar encoding of accepted immutable storage
///
/// - value: validated storage reference
/// - binding: wire selection
/// - encoding: use-site override
/// - writer: unpublished JSON event output
fn _write_${p.id}(value: &${type.name}, ${aware ? "binding" : "_binding"}: Binding, ${aware ? "encoding" : "_encoding"}: Option<&str>, writer: &mut _JsonWriter) {
    ${aware ? `let encoding = ${encodingChoice(type)};` : ""}
    ${type.role === null ? "" : "let value = &value.0;"}
    ${p.codec.encode}
}
`;
}

/** Scalar declaration with a separate role only when requested
 * @param ctx - Generation context
 * @param type - Resolved scalar
 * @returns Rust declaration, private codec and public entry points
 */
export function renderScalar(ctx: RustContext, type: ScalarType): string {
  const p = plan(ctx, type);
  const guard =
    type.role !== type.id && p.checks !== ""
      ? asserted(
          `_check_${p.id}(value, 0, state);`,
          `invalid ${type.name} value at the encode boundary`,
        )
      : "";
  return `${declaration(type, p)}
${parseFunction(type, p, p.checks === "" ? "_decode_" : "_parse_")}${checkedFunctions(type, p)}${encodeFunction(type, p)}${publicCodec(type, guard)}`;
}
