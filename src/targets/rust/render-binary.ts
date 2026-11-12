import type { Field, ObjectType, Operation } from "../../model/contract-model.js";
import { hasBaseChecks } from "./checks.js";
import { node, type RustContext } from "./context.js";
import { key, quote, snake } from "./naming.js";
import { rawBytes } from "./media.js";
import { decodeField, encodeMember } from "./object-members.js";

/** Input member that travels as the raw request body
 * @param ctx - Resolved generation context
 * @param operation - Canonical operation
 * @returns The input object and its raw body member, or undefined when no body member is raw
 */
export function rawBodyField(
  ctx: RustContext,
  operation: Operation,
): { readonly input: ObjectType; readonly field: Field } | undefined {
  const http = operation.http;
  const input = node(ctx, operation.input);
  if (http?.body.kind !== "parameter" || input.kind !== "object") return undefined;
  const selected = http.body.parameter;
  const field = input.fields.find((candidate) => candidate.name === selected);
  return field !== undefined && rawBytes(ctx, field.type, http.requestMediaType)
    ? { input, field }
    : undefined;
}

/** Statement binding the raw body member from received bytes
 * @param ctx - Resolved generation context
 * @param field - Raw body member
 * @returns Rust statement binding `field_<name>` to the Option the shared completion expects
 */
function bodyMember(ctx: RustContext, field: Field): string {
  const scalar = node(ctx, field.type.id);
  const role =
    scalar.kind === "scalar" && scalar.role !== null ? node(ctx, scalar.role).name : undefined;
  const wire = quote(field.wireName);
  const base =
    scalar.kind === "scalar" && scalar.role === scalar.id && hasBaseChecks(scalar)
      ? `_check_${key(scalar)}(&value, &pointer(path, ${wire}), state);`
      : "";
  const present = `{ let value = ${role === undefined ? "bytes" : `${role}(bytes)`}; ${base} Some(${field.optional ? "Some(value)" : "value"}) }`;
  const absent = field.optional
    ? "Some(None)"
    : `{ state.reject(&pointer(path, ${wire}), "required"); None }`;
  return `let field_${snake(field.name)} = match bytes { Some(bytes) => ${present}, None => ${absent} };`;
}

/** Decoding of the nonbody parameters and the raw body through the shared completion
 * @param ctx - Resolved generation context
 * @param operation - Canonical operation
 * @param input - Input object
 * @param body - Raw body member
 * @returns Rust public function
 */
function binaryDecoder(
  ctx: RustContext,
  operation: Operation,
  input: ObjectType,
  body: Field,
): string {
  const members = input.fields.map((field) =>
    field.name === body.name ? bodyMember(ctx, field) : decodeField(ctx, field),
  );
  const rest = input.fields.map((field) => `, field_${snake(field.name)}`).join("");
  const others = input.fields.length > 1;
  const op = snake(operation.name);
  return `
/// Raw HTTP body completion without binary text conversion
///
/// - parameters: parsed nonbody parameter object
/// - bytes: owned raw body including an empty byte sequence, absent without a body
/// - Return: completed pre-default operation input
/// # Errors
/// Binary constraints or nonbody member violations
pub fn decode_${op}_http_binary(parameters: Value, bytes: Option<bytes::Bytes>) -> Result<Accepted<${input.name}>, ValidationFailure> {
    let mut state = State::default();
    let value = _decode_${op}_http_binary(parameters, bytes, &mut state);
    state.finish(value)
}
/// Raw HTTP body decoding through the input completion shared with every other path
///
/// - parameters: parsed nonbody parameter object
/// - bytes: owned raw body, absent without a body
/// - state: incomplete graph state
/// - Return: complete input candidate
fn _decode_${op}_http_binary(parameters: Value, bytes: Option<bytes::Bytes>, state: &mut State) -> Option<${input.name}> {
    ${others ? "let binding = Binding::Http;" : ""}
    let path = "";
    let ${others ? "mut " : ""}object = object(parameters, path, state)?;
    ${members.join("\n")}
    unknown(object, path, state);
    _complete_${key(input)}(path, state${rest})
}`;
}

/** Nonbody parameter encoding and raw body extraction
 * @param ctx - Resolved generation context
 * @param operation - Canonical operation
 * @param input - Input object
 * @param body - Raw body member
 * @returns Rust public functions
 */
function binaryEncoders(
  ctx: RustContext,
  operation: Operation,
  input: ObjectType,
  body: Field,
): string {
  const scalar = node(ctx, body.type.id);
  const nominal = scalar.kind === "scalar" && scalar.role !== null;
  const inserts = input.fields
    .filter((field) => field.name !== body.name)
    .map((field) => encodeMember(ctx, field, "input", "parameters"));
  const others = inserts.length > 0;
  const bound = input.fields.map((field) =>
    field.name === body.name ? `${snake(field.name)},` : "_,",
  );
  const taken = nominal ? "into_value()" : "";
  const extract = body.optional
    ? `${snake(body.name)}.map(|value| ${nominal ? "value.into_value()" : "value"})`
    : `Some(${snake(body.name)}${nominal ? `.${taken}` : ""})`;
  const op = snake(operation.name);
  return `
/// Nonbody HTTP parameters without touching raw binary storage
///
/// - input: validated pre-default parameters
/// - Return: binding-encoded nonbody parameters
pub fn encode_${op}_http_parameters(input: &${input.name}) -> Value {
    ${others ? "let binding = Binding::Http;" : ""}
    let ${others ? "mut " : ""}parameters = Map::new();
    ${inserts.join("\n")}
    Value::Object(parameters)
}
/// Consuming binary parameter extraction without copying owned bytes
///
/// - input: owned pre-default parameters after nonbody encoding
/// - Return: raw owned binary body with optional presence
pub fn into_${op}_http_body(input: ${input.name}) -> Option<bytes::Bytes> {
    let (${bound.join(" ")}) = input.into_parts();
    ${extract}
}
`;
}

/** Raw binary request handling without a base64 encode/decode detour
 * @param ctx - Resolved generation context
 * @returns Pure ownership-preserving operation helpers
 */
export function renderBinary(ctx: RustContext): string {
  return ctx.model.operations
    .map((operation) => {
      const raw = rawBodyField(ctx, operation);
      return raw === undefined
        ? ""
        : binaryDecoder(ctx, operation, raw.input, raw.field) +
            binaryEncoders(ctx, operation, raw.input, raw.field);
    })
    .join("\n");
}
