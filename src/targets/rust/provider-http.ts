import type { HttpBinding } from "../../model/binding-model.js";
import type { Operation } from "../../model/contract-model.js";
import { node, type RustContext } from "./context.js";
import { essenceOf, rawBytes } from "./media.js";
import { quote, snake, stem } from "./naming.js";

/** Shape of one HTTP provider function derived from its binding */
interface HttpPlan {
  /** Operation function stem */
  readonly op: string;
  /** Complete HTTP interpretation */
  readonly binding: HttpBinding;
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

/** Native nonbody text extraction for the types-crate projection
 * @param plan - HTTP plan
 * @param operation - Canonical operation
 * @returns Typed text placements
 */
function assembly(plan: HttpPlan, operation: Operation): string {
  const inserts = plan.binding.parameters.map((mapping) => {
    const source =
      mapping.location === "path"
        ? `path.remove(${quote(mapping.wireName)})`
        : mapping.location === "query"
          ? `query.remove(${quote(mapping.wireName)})`
          : `parts.headers.get(${quote(mapping.wireName)}).map(|value| value.to_str().map(str::to_owned)).transpose().map_err(|_| ProviderFailure::InvalidInput(invalid_parameter()))?`;
    return `${snake(mapping.parameter)}: ${source},`;
  });
  return `let placements = ${stem(operation)}HttpPlacements { ${inserts.join("\n")} };`;
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
          : `axum::body::Body::from(encode_${plan.op}_${out}(&value, Binding::Http))`;
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
  return { op: snake(operation.name), binding };
}

/** Actual HTTP provider request completion and dispatch
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Provider function for the operation route, or an empty string
 */
export function renderHttp(ctx: RustContext, operation: Operation): string {
  const plan = planOf(ctx, operation);
  if (plan === undefined) return "";
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
    ${assembly(plan, operation)}
    let accepted = decode_${plan.op}_http_request(${plan.binding.body.kind === "none" ? "None" : "has_body.then_some(bytes)"}, placements).map_err(ProviderFailure::InvalidInput)?;
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
