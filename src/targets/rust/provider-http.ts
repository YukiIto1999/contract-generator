import type { HttpBinding } from "../../model/binding-model.js";
import type { Field, ObjectType, Operation } from "../../model/contract-model.js";
import { node, type RustContext } from "./context.js";
import { parameterValue } from "./http-parameters.js";
import { essenceOf, rawBytes } from "./media.js";
import { key, quote, snake, stem } from "./naming.js";

/** Shape of one HTTP provider function derived from its binding */
interface HttpPlan {
  /** Operation function stem */
  readonly op: string;
  /** Complete HTTP interpretation */
  readonly binding: HttpBinding;
  /** Operation input object */
  readonly input: ObjectType;
  /** Body parameter member, when the body carries one parameter */
  readonly bodyField: Field | undefined;
  /** Whether the body parameter is raw bytes */
  readonly raw: boolean;
}

/** Whether the binding places a parameter at a location
 * @param plan - HTTP plan
 * @param location - Placement location
 * @returns True when some parameter is placed there
 */
function placed(plan: HttpPlan, location: string): boolean {
  return plan.binding.parameters.some((mapping) => mapping.location === location);
}

/** Request identification, body collection and media-type enforcement
 * @param plan - HTTP plan
 * @returns Rust statements ending with the collected `bytes`
 */
function requestHead(plan: HttpPlan): string {
  const { binding } = plan;
  const route = quote(binding.path);
  const media =
    binding.body.kind === "none"
      ? "if !bytes.is_empty() { return Err(ProviderFailure::InvalidInput(invalid_parameter())); }"
      : `let has_body = !bytes.is_empty() || parts.headers.contains_key(axum::http::header::CONTENT_TYPE); if has_body && parts.headers.get(axum::http::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).is_none_or(|value| !essence(value).eq_ignore_ascii_case(${quote(essenceOf(binding.requestMediaType))})) { return Err(ProviderFailure::InvalidInput(invalid_parameter())); }`;
  return `if parts.method.as_str() != ${quote(binding.method)} || !route_matches(${route}, parts.uri.path()) { return Err(ProviderFailure::UnknownOperation); }
    ${placed(plan, "path") ? `let mut path = route_parameters(${route}, parts.uri.path()).ok_or_else(|| ProviderFailure::InvalidInput(invalid_parameter()))?;` : ""}
    ${placed(plan, "query") ? 'let mut query: std::collections::HashMap<String, String> = url::form_urlencoded::parse(parts.uri.query().unwrap_or("").as_bytes()).into_owned().collect();' : ""}
    let bytes = { use http_body_util::BodyExt as _; body.collect().await.map_err(|_| ProviderFailure::Communication)?.to_bytes() };
    ${media}`;
}

/** Parameter object assembly from the body and every placement
 * @param ctx - Rendering context
 * @param plan - HTTP plan
 * @returns Rust statements binding the mutable `parameters` object and `placement_diagnostics`
 */
function assembly(ctx: RustContext, plan: HttpPlan): string {
  const { binding, input, bodyField } = plan;
  const mutated = binding.parameters.length > 0 || (bodyField !== undefined && !plan.raw);
  const init =
    binding.body.kind === "parameters"
      ? `let ${mutated ? "mut " : ""}parameters = if bytes.is_empty() { serde_json::Map::new() } else { match std::str::from_utf8(&bytes).ok().and_then(|text| parse_json(text).ok()) { Some(Value::Object(value)) => value, _ => return Err(ProviderFailure::InvalidInput(invalid_json())) } };`
      : `let ${mutated ? "mut " : ""}parameters = serde_json::Map::new();`;
  const shadowed =
    binding.body.kind === "parameters"
      ? binding.parameters.map((mapping) => {
          const field = input.fields.find((candidate) => candidate.name === mapping.parameter);
          const wire = field?.wireName ?? mapping.wireName;
          return `if parameters.remove(${quote(wire)}).is_some() { placement_diagnostics.push(Diagnostic { path: String::new(), key: ${quote(wire)}.into() }); }`;
        })
      : [];
  const body =
    bodyField !== undefined && !plan.raw
      ? `if !bytes.is_empty() { parameters.insert(${quote(bodyField.wireName)}.into(), std::str::from_utf8(&bytes).ok().and_then(|text| parse_json(text).ok()).ok_or_else(|| ProviderFailure::InvalidInput(invalid_json()))?); }`
      : "";
  const inserts = binding.parameters.map((mapping) => {
    const field = input.fields.find((candidate) => candidate.name === mapping.parameter);
    if (field === undefined) return "";
    const source =
      mapping.location === "path"
        ? `path.remove(${quote(mapping.wireName)})`
        : mapping.location === "query"
          ? `query.remove(${quote(mapping.wireName)})`
          : `parts.headers.get(${quote(mapping.wireName)}).map(|value| value.to_str().map(str::to_owned)).transpose().map_err(|_| ProviderFailure::InvalidInput(invalid_parameter()))?`;
    return `if let Some(text) = ${source} { parameters.insert(${quote(field.wireName)}.into(), ${parameterValue(ctx, field)}); }`;
  });
  return `${init}
    let mut placement_diagnostics = Vec::new();
    ${shadowed.join("\n")}
    ${body}
    ${inserts.join("\n")}`;
}

/** Declared response arm of one handler result
 * @param plan - HTTP plan
 * @param operation - Canonical operation
 * @param ctx - Rendering context
 * @returns Rust match arms mapping handler results to responses
 */
function responseArms(ctx: RustContext, plan: HttpPlan, operation: Operation): string {
  const name = stem(operation);
  const arms = plan.binding.results.map((mapping) => {
    const outcome = operation.outcomes.find((candidate) => candidate.name === mapping.outcome);
    if (outcome === undefined) return "";
    const out = snake(outcome.name);
    const body =
      outcome.type === undefined
        ? "axum::body::Body::empty()"
        : rawBytes(ctx, outcome.type, mapping.mediaType)
          ? `axum::body::Body::from(into_${plan.op}_${out}_bytes(value))`
          : `axum::body::Body::from(encode_${plan.op}_${out}(&value, Binding::Http).to_string())`;
    const headers = [
      ...(mapping.mediaType === undefined ? [] : [["content-type", mapping.mediaType]]),
      ...Object.entries(mapping.headers),
    ].map(([header, value]) => `(${quote(header ?? "")}, ${quote(value ?? "")})`);
    const response = `declared_response(${mapping.status}, &[${headers.join(", ")}], ${body})`;
    const pattern = outcome.rejection
      ? `Err(HandlerFailure::Rejected(${name}Rejection::${outcome.name}${outcome.type ? "(value)" : ""}))`
      : `Ok(${name}Success::${outcome.name}${outcome.type ? "(value)" : ""})`;
    return `${pattern} => ${response},`;
  });
  return arms.join("\n");
}

/** HTTP plan of an operation published over HTTP
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Plan, or undefined when the operation is not published over HTTP
 */
function planOf(ctx: RustContext, operation: Operation): HttpPlan | undefined {
  const binding = operation.http;
  const input = node(ctx, operation.input);
  if (binding === undefined || input.kind !== "object") return undefined;
  const bodyField =
    binding.body.kind === "parameter"
      ? input.fields.find(
          (field) => binding.body.kind === "parameter" && field.name === binding.body.parameter,
        )
      : undefined;
  const raw = bodyField !== undefined && rawBytes(ctx, bodyField.type, binding.requestMediaType);
  return { op: snake(operation.name), binding, input, bodyField, raw };
}

/** Actual HTTP provider request completion and dispatch
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Provider function for the operation route, or an empty string
 */
export function renderHttp(ctx: RustContext, operation: Operation): string {
  const plan = planOf(ctx, operation);
  if (plan === undefined) return "";
  const decode = plan.raw
    ? `decode_${plan.op}_http_binary(Value::Object(parameters), has_body.then_some(bytes))`
    : `decode_${key(plan.input)}_value(Value::Object(parameters), Binding::Http)`;
  return `
/// Actual HTTP provider request completion and dispatch
///
/// - handler: hand-written contract adapter
/// - request: actual native HTTP request
/// - token: original host cancellation
/// - deadline: original absolute host deadline
/// - Return: exact declared HTTP response with input diagnostics
/// # Errors
/// Invalid request, a request this operation does not publish, interrupted request body or cooperative cancellation
pub async fn ${plan.op}_http<H: Handler>(handler: &H, request: axum::http::Request<axum::body::Body>, token: &CancellationToken, deadline: Option<Instant>) -> Result<Accepted<axum::response::Response>, ProviderFailure> {
    if token.is_cancelled() { return Err(ProviderFailure::Cancelled); }
    let (parts, body) = request.into_parts();
    ${requestHead(plan)}
    ${assembly(ctx, plan)}
    let accepted = ${decode};
    let mut accepted = match accepted { Ok(value) => value, Err(mut failure) => { failure.diagnostics.append(&mut placement_diagnostics); return Err(ProviderFailure::InvalidInput(failure)); } };
    accepted.diagnostics.append(&mut placement_diagnostics);
    let outcome = handler.${plan.op}(accept_${plan.op}(accepted.value), token, deadline).await;
    let response = match outcome { ${responseArms(ctx, plan, operation)}
      Err(HandlerFailure::Cancelled) => return Err(ProviderFailure::Cancelled),
    };
    Ok(Accepted { value: response, diagnostics: accepted.diagnostics })
}
`;
}

/** Method and route test of one operation for the HTTP dispatcher
 * @param operation - Canonical operation
 * @returns Rust branch delegating to the operation, or an empty string
 */
export function httpBranch(operation: Operation): string {
  const http = operation.http;
  if (http === undefined) return "";
  return `if method == ${quote(http.method)} && route_matches(${quote(http.path)}, path) { return ${snake(operation.name)}_http(handler, request, token, deadline).await; }`;
}
