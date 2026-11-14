import type { Field, ObjectType, Operation } from "../../model/contract-model.js";
import { node, type RustContext } from "./context.js";
import {
  decodedHttpBody,
  encodedHttpBody,
  encodedMember,
  initialHttpBody,
} from "./http-projection-body.js";
import { httpProjectionPlan, type HttpProjectionPlan } from "./http-projection-plan.js";
import { parameterValue } from "./http-parameters.js";
import { doc, quote, snake } from "./naming.js";
import { rawBytes } from "./media.js";

/** Input member carried as an unencoded binary body
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Raw member with its input object
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

/** Transport-free request declarations for resolved HTTP placements
 * @param plan - Resolved request projection
 * @returns Typed placement and body declarations
 */
function httpRequestTypes(plan: HttpProjectionPlan): string {
  const { name, fields } = plan;
  return `
/// HTTP placement text without a transport-library dependency
#[derive(Default)]
pub struct ${name}HttpPlacements { ${fields.map((field) => `${doc("", `Received or encoded ${field.wireName} placement`)}\npub ${snake(field.name)}: Option<String>,`).join("\n")} }
/// HTTP request projection without a transport-library dependency
pub struct ${name}HttpRequest {
    /// Nonbody parameter text
    pub placements: ${name}HttpPlacements,
    /// Optional owned request body
    pub body: Option<bytes::Bytes>,
}`;
}

/** HTTP input completion with placement precedence diagnostics
 * @param ctx - Rendering context
 * @param plan - Resolved request projection
 * @returns Typed request decoder
 */
function httpRequestDecoder(ctx: RustContext, plan: HttpProjectionPlan): string {
  const { http, fields, op, name, input } = plan;
  const shadow =
    http.body.kind === "parameters"
      ? fields
          .map(
            (field) =>
              `if parameters.remove(${quote(field.wireName)}).is_some() { placement_diagnostics.push(Diagnostic { path: String::new(), key: ${quote(field.wireName)}.into() }); }`,
          )
          .join("\n")
      : "";
  const inserts = fields
    .map(
      (field) =>
        `if let Some(text) = placements.${snake(field.name)} { let value = ${parameterValue(ctx, field)}; let id = json.nodes.len(); json.nodes.push(value); parameters.insert(${quote(field.wireName)}.into(), id); }`,
    )
    .join("\n");
  return `
/// HTTP input completion from native body bytes and text placements
///
/// - body: optional complete request body
/// - placements: received nonbody parameter text
/// - Return: completed input with diagnostics
/// # Errors
/// Malformed JSON or parameter contract violations
pub fn decode_${op}_http_request(${http.body.kind === "none" ? "_body" : "body"}: Option<bytes::Bytes>, ${fields.length > 0 ? "placements" : "_placements"}: ${name}HttpPlacements) -> Result<Accepted<${input.name}>, ValidationFailure> {
    ${initialHttpBody(plan)}
    let mut placement_diagnostics = Vec::new();
    ${shadow}
    ${inserts}
    let mut state = State::default();
    ${decodedHttpBody(ctx, plan)}
    match state.finish(value) { Ok(mut accepted) => { accepted.diagnostics.append(&mut placement_diagnostics); Ok(accepted) }, Err(mut failure) => { failure.diagnostics.append(&mut placement_diagnostics); Err(failure) } }
}`;
}

/** HTTP request encoding with scalar text placements
 * @param ctx - Rendering context
 * @param plan - Resolved request projection
 * @returns Typed request encoder
 */
function httpRequestEncoder(ctx: RustContext, plan: HttpProjectionPlan): string {
  const { fields, usesInput, usesEncoding, input, op, name } = plan;
  const placementEncoding = fields
    .map((field) =>
      encodedMember(
        ctx,
        field,
        `placements.${snake(field.name)} = Some(if text.starts_with('"') { let Ok(value) = serde_json::from_str::<String>(&text) else { panic!("encoded scalar string"); }; value } else { text });`,
      ),
    )
    .join("\n");
  return `
/// HTTP body projection with exact text placements
///
/// - input: validated pre-default input
/// - Return: owned body and nonbody text
/// # Panics
/// An encoded placement violating its scalar wire representation
pub fn encode_${op}_http_request(${usesInput ? "input" : "_input"}: ${input.name}) -> ${name}HttpRequest {
    ${usesEncoding ? "let binding = Binding::Http;" : ""}
    let ${fields.length > 0 ? "mut " : ""}placements = ${name}HttpPlacements::default();
    ${placementEncoding}
    ${encodedHttpBody(ctx, plan)}
    ${name}HttpRequest { placements, body }
}
`;
}

/** Transport-free text placements and body projection for one HTTP operation
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Types-crate request projection codecs
 */
function httpProjection(ctx: RustContext, operation: Operation): string {
  const input = node(ctx, operation.input);
  if (input.kind !== "object") return "";
  const plan = httpProjectionPlan(operation, input, rawBodyField(ctx, operation)?.field);
  if (plan === undefined) return "";
  return httpRequestTypes(plan) + httpRequestDecoder(ctx, plan) + httpRequestEncoder(ctx, plan);
}

/** Operation-specific HTTP request codecs
 * @param ctx - Rendering context
 * @returns Transport-independent projection helpers
 */
export function renderBinary(ctx: RustContext): string {
  return ctx.model.operations.map((operation) => httpProjection(ctx, operation)).join("\n");
}
