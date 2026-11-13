import type { Operation, Outcome, TypeUse } from "../../model/contract-model.js";
import { asserted, completeUse, finished, hasBaseChecks } from "./checks.js";
import { decodeUse, encodeUse } from "./codec-use.js";
import { node, type RustContext } from "./context.js";
import { doc, key, quote, snake, stem } from "./naming.js";
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
  const checks = completeUse(ctx, use, "decoded", "0");
  return `
/// Outcome payload boundary completion
///
/// - value: complete UTF-8 binding-encoded payload
/// - binding: selected wire interpretation
/// - Return: complete declared payload with diagnostics
/// # Errors
/// Payload contract violations
pub fn decode_${snake(operation.name)}_${snake(outcome.name)}(value: &str, binding: Binding) -> Result<Accepted<${useType(ctx, use)}>, ValidationFailure> {
    let mut json = parse_json(value)?;
    let root = json.root;
    _decode_${snake(operation.name)}_${snake(outcome.name)}_payload(&mut json, root, binding)
}
/// Outcome completion within a private parsed document
///
/// - json: private flat document
/// - value: payload node
/// - binding: selected wire interpretation
/// - Return: completed payload
fn _decode_${snake(operation.name)}_${snake(outcome.name)}_payload(json: &mut _Json, value: usize, binding: Binding) -> Result<Accepted<${useType(ctx, use)}>, ValidationFailure> {
    let mut state = State::default();
    let decoded = { let state = &mut state; ${decodeUse(ctx, use, "value", "0")} };
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
  const checks = completeUse(ctx, use, "value", "0");
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
pub fn encode_${op}_${out}(value: &${useType(ctx, use)}, binding: Binding) -> String {
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
      ? `_check_${key(scalar)}(&value, 0, state);`
      : "";
  const checks = `${base} ${completeUse(ctx, use, "&value", "0")}`;
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
    ${role === undefined ? "" : `let value = ${role}(value);`}
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

/** Typed IPC result envelope encoding
 * @param operation - Canonical operation
 * @returns Text-only IPC encoder
 */
function ipcEncoder(operation: Operation): string {
  if (operation.ipc === undefined) return "";
  const op = snake(operation.name);
  const name = stem(operation);
  const encode = operation.ipc.results.map((mapping) => {
    const outcome = operation.outcomes.find((candidate) => candidate.name === mapping.outcome);
    if (outcome === undefined) return "";
    const variant = `${name}${outcome.rejection ? "Rejection" : "Success"}::${outcome.name}`;
    const prefix = JSON.stringify({ tag: mapping.tag }).slice(0, -1);
    const body =
      outcome.type === undefined
        ? `${quote(`${prefix}}`)}.to_owned()`
        : `{ let mut text = ${quote(`${prefix},"body":`)}.to_owned(); text.push_str(&encode_${op}_${snake(outcome.name)}(&value, Binding::Ipc)); text.push('}'); text }`;
    return `${outcome.rejection ? "Err" : "Ok"}(${variant}${outcome.type === undefined ? "" : "(value)"}) => ${body},`;
  });
  return `
/// Complete IPC result envelope encoding
///
/// - result: declared adapter result
/// - Return: complete owned UTF-8 JSON envelope
/// # Panics
/// An adapter payload violating its declared restrictions
pub fn encode_${op}_ipc_result(result: Result<${name}Success, ${name}Rejection>) -> String {
    match result { ${encode.join("\n")} }
}`;
}

/** Typed IPC result envelope decoding
 * @param operation - Canonical operation
 * @returns Text-only IPC decoder
 */
function ipcDecoder(operation: Operation): string {
  if (operation.ipc === undefined) return "";
  const op = snake(operation.name);
  const name = stem(operation);
  const decode = operation.ipc.results.map((mapping) => {
    const outcome = operation.outcomes.find((candidate) => candidate.name === mapping.outcome);
    if (outcome === undefined) return "";
    const variant = `${name}${outcome.rejection ? "Rejection" : "Success"}::${outcome.name}`;
    const body =
      outcome.type === undefined
        ? 'assert!(body.is_none(), "a void IPC result must omit its body");'
        : `let Some(body) = body else { panic!("a payload IPC result requires a body even for null"); }; let Ok(mut accepted) = _decode_${op}_${snake(outcome.name)}_payload(&mut json, body, Binding::Ipc) else { panic!("response payload violates the selected declared result"); }; accepted.diagnostics.extend(diagnostics); let diagnostics = accepted.diagnostics;`;
    return `${quote(mapping.tag)} => { ${body} ${outcome.rejection ? "Err" : "Ok"}(Accepted { value: ${variant}${outcome.type === undefined ? "" : "(accepted.value)"}, diagnostics }) },`;
  });
  return `
/// Complete IPC result envelope decoding
///
/// - text: complete received UTF-8 JSON
/// - Return: declared result with ignored-member diagnostics
/// # Errors
/// Declared operation rejection
/// # Panics
/// Invalid result envelope or payload
pub fn decode_${op}_ipc_result(text: &str) -> Result<Accepted<${name}Success>, Accepted<${name}Rejection>> {
    let Ok(mut json) = parse_json(text) else { panic!("an IPC result must be JSON"); };
    let _JsonNode::Object(mut envelope) = json.take(json.root) else { panic!("an IPC result envelope must be an object"); };
    let Some(tag) = envelope.remove("tag") else { panic!("an IPC result tag must be present"); };
    let _JsonNode::String(tag) = json.take(tag) else { panic!("an IPC result tag must be a string"); };
    let body = envelope.remove("body");
    let diagnostics: Vec<Diagnostic> = envelope.into_keys().map(|key| Diagnostic { path: String::new(), key }).collect();
    match tag.as_str() { ${decode.join("\n")} _ => panic!("an IPC result tag is not declared") }
}
`;
}

/** Transport-independent operation result codecs and typed branches
 * @param ctx - Resolved rendering context
 * @returns Pure operation declarations
 */
export function renderWire(ctx: RustContext): string {
  return ctx.model.operations
    .map(
      (operation) =>
        `\n${resultEnums(ctx, operation)}\n${payloadFunctions(ctx, operation)}\n${ipcEncoder(operation)}${ipcDecoder(operation)}`,
    )
    .join("\n");
}
