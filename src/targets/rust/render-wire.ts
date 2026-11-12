import type { Operation, Outcome, TypeUse } from "../../model/contract-model.js";
import { asserted, completeUse, finished, hasBaseChecks } from "./checks.js";
import { decodeUse, encodeUse } from "./codec-use.js";
import { node, type RustContext } from "./context.js";
import { doc, key, snake, stem } from "./naming.js";
import { rawOutcome } from "./media.js";
import { useType } from "./storage.js";

/** Bodyless-or-payload outcome variant spelling
 * @param ctx - Rendering context
 * @param outcome - Canonical operation outcome
 * @returns Rust variant declaration
 */
function variant(ctx: RustContext, outcome: Outcome): string {
  return `${doc(outcome.description, `Canonical ${outcome.name} result`)}\n${outcome.name}${outcome.type === undefined ? "" : `(${useType(ctx, outcome.type)})`},`;
}

/** Separate success and rejection enums of an operation
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Rust enum declarations
 */
function resultEnums(ctx: RustContext, operation: Operation): string {
  const name = stem(operation);
  const cases = (rejection: boolean): string =>
    operation.outcomes
      .filter((outcome) => outcome.rejection === rejection)
      .map((outcome) => variant(ctx, outcome))
      .join("\n");
  return `/// Declared successful operation paths without body-shape guessing
#[derive(Debug, Clone, PartialEq)]
pub enum ${name}Success { ${cases(false)} }
/// Declared operation rejections in the expected failure path
#[derive(Debug, Clone, PartialEq)]
pub enum ${name}Rejection { ${cases(true)} }`;
}

/** Payload decoding with the use-site completion applied once
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @param outcome - Outcome carrying a payload
 * @param use - Payload use
 * @returns Rust public function
 */
function payloadDecoder(
  ctx: RustContext,
  operation: Operation,
  outcome: Outcome,
  use: TypeUse,
): string {
  const checks = completeUse(ctx, use, "decoded", '""');
  return `
/// Outcome payload boundary completion
///
/// - value: binding-encoded payload
/// - binding: selected wire interpretation
/// - Return: complete declared payload with diagnostics
/// # Errors
/// Payload contract violations
pub fn decode_${snake(operation.name)}_${snake(outcome.name)}(value: Value, binding: Binding) -> Result<Accepted<${useType(ctx, use)}>, ValidationFailure> {
    let mut state = State::default();
    let decoded = { let state = &mut state; ${decodeUse(ctx, use, "value", '""')} };
    ${checks === "" ? "" : `if let Some(decoded) = &decoded { let state = &mut state; ${checks} }`}
    state.finish(decoded)
}`;
}

/** Adapter output invariant assertion and wire encoding of a payload
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @param outcome - Outcome carrying a payload
 * @param use - Payload use
 * @returns Rust public functions
 */
function payloadEncoder(
  ctx: RustContext,
  operation: Operation,
  outcome: Outcome,
  use: TypeUse,
): string {
  const op = snake(operation.name);
  const out = snake(outcome.name);
  const checks = completeUse(ctx, use, "value", '""');
  const subject = `${operation.name} ${outcome.name} payload produced by the contract adapter`;
  return `
/// Adapter output invariant assertion without child graph revalidation
///
/// - value: output value claiming the declared payload contract
/// # Panics
/// A payload violating its primitive or use-site restrictions
pub fn assert_${op}_${out}(${checks === "" ? "_value" : "value"}: &${useType(ctx, use)}) {
    ${checks === "" ? "" : asserted(checks, subject)}
}
/// Outcome payload wire encoding
///
/// - value: validated outcome payload
/// - binding: selected wire interpretation
/// - Return: exact selected wire payload
/// # Panics
/// A payload violating its primitive or use-site restrictions
pub fn encode_${op}_${out}(value: &${useType(ctx, use)}, binding: Binding) -> Value {
    assert_${op}_${out}(value);
    ${encodeUse(ctx, use, "value")}
}`;
}

/** Raw HTTP body decoding and extraction of a bytes payload under a non-JSON media type
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @param outcome - Outcome carrying a raw bytes payload
 * @param use - Payload use
 * @returns Rust public functions
 */
function rawFunctions(
  ctx: RustContext,
  operation: Operation,
  outcome: Outcome,
  use: TypeUse,
): string {
  const scalar = node(ctx, use.id);
  const role =
    scalar.kind === "scalar" && scalar.role !== null ? node(ctx, scalar.role).name : undefined;
  const base =
    scalar.kind === "scalar" && scalar.role === scalar.id && hasBaseChecks(scalar)
      ? `_check_${key(scalar)}(&value, "", state);`
      : "";
  const checks = `${base} ${completeUse(ctx, use, "&value", '""')}`;
  const op = snake(operation.name);
  const out = snake(outcome.name);
  return `
/// Exact raw binary outcome decoding
///
/// - value: owned raw bytes including the empty sequence
/// - Return: accepted payload
/// # Errors
/// Binary payload constraints
pub fn decode_${op}_${out}_bytes(value: bytes::Bytes) -> Result<Accepted<${useType(ctx, use)}>, ValidationFailure> {
    let value = ${role === undefined ? "value" : `${role}(value)`};
    ${finished(checks, "Some(value)")}
}
/// Consuming raw binary outcome extraction
///
/// - value: validated owned payload
/// - Return: moved raw bytes
/// # Panics
/// A payload violating its primitive or use-site restrictions
pub fn into_${op}_${out}_bytes(value: ${useType(ctx, use)}) -> bytes::Bytes {
    assert_${op}_${out}(&value);
    ${role === undefined ? "value" : "value.into_value()"}
}`;
}

/** Transport-independent codecs of every payload an operation declares
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Rust public functions
 */
function payloadFunctions(ctx: RustContext, operation: Operation): string {
  return operation.outcomes
    .map((outcome) => {
      const use = outcome.type;
      if (use === undefined) return "";
      const raw = rawOutcome(ctx, operation, outcome)
        ? rawFunctions(ctx, operation, outcome, use)
        : "";
      return (
        payloadDecoder(ctx, operation, outcome, use) +
        payloadEncoder(ctx, operation, outcome, use) +
        raw
      );
    })
    .join("\n");
}

/** Transport-independent operation result codecs and typed branches
 * @param ctx - Resolved rendering context
 * @returns Pure operation declarations
 */
export function renderWire(ctx: RustContext): string {
  return ctx.model.operations
    .map((operation) => `\n${resultEnums(ctx, operation)}\n${payloadFunctions(ctx, operation)}\n`)
    .join("\n");
}
