import type { HttpBinding, HttpResult } from "../../model/binding-model.js";
import type { Operation } from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { complete } from "./client-complete.js";
import { node, type RustContext } from "./context.js";
import { doc, quote, snake, stem } from "./naming.js";
import { essenceOf, rawBytes } from "./media.js";

/** Placement statement of one nonbody parameter
 * @param mapping - Parameter placement
 * @returns Rust statement moving the encoded parameter to its location
 */
function placement(mapping: HttpBinding["parameters"][number]): string {
  const target =
    mapping.location === "path"
      ? `let Some(segment) = path_segment(&value) else { return Err(OperationFailure::Communication); }; route = route.replace(${quote(`{${mapping.wireName}}`)}, &segment);`
      : mapping.location === "query"
        ? `query.push((${quote(mapping.wireName)}, value));`
        : `let Ok(value) = reqwest::header::HeaderValue::from_str(&value) else { return Err(OperationFailure::Communication); }; headers.insert(reqwest::header::HeaderName::from_static(${quote(mapping.wireName.toLowerCase())}), value);`;
  return `if let Some(value) = placements.${snake(mapping.parameter)} { ${target} }`;
}

/** Result identity condition of one mapping
 * @param mapping - Declared HTTP result
 * @returns Rust boolean expression over `response`
 */
function identity(mapping: HttpResult): string {
  const media =
    mapping.mediaType === undefined
      ? "response.body.is_empty() && !response.headers.contains_key(reqwest::header::CONTENT_TYPE)"
      : `single_header(&response.headers, reqwest::header::CONTENT_TYPE.as_str()).is_some_and(|value| essence(value).eq_ignore_ascii_case(${quote(essenceOf(mapping.mediaType))}))`;
  const selectors = Object.entries(mapping.headers)
    .toSorted(([a], [b]) => compareText(a, b))
    .map(
      ([name, value]) =>
        `single_header(&response.headers, ${quote(name)}) == Some(${quote(value)})`,
    );
  return [`response.status == ${mapping.status}`, media, ...selectors].join(" && ");
}

/** Identity branch selecting one declared result before its body is decoded
 * @param ctx - Resolved generation context
 * @param operation - Canonical operation
 * @param mapping - Declared HTTP result
 * @returns Rust branch returning the typed result
 */
function resultBranch(ctx: RustContext, operation: Operation, mapping: HttpResult): string {
  const outcome = operation.outcomes.find((candidate) => candidate.name === mapping.outcome);
  if (outcome === undefined) return "";
  const raw = rawBytes(ctx, outcome.type, mapping.mediaType);
  const parse =
    outcome.type === undefined || raw
      ? ""
      : 'let body = match std::str::from_utf8(&response.body) { Ok(body) => body, Err(_) if gateway => return Err(OperationFailure::Communication), Err(_) => panic!("a selected HTTP payload is not UTF-8 JSON") };';
  return `if ${identity(mapping)} {
        ${parse}
        return { ${complete(operation, outcome, raw ? "response.body" : "body", "gateway", raw)} };
      }`;
}

/** Documented external contract shared by every generated HTTP client operation */
const httpContract = `///
/// - transport: injected actual HTTP connection
/// - input: accepted pre-default parameters
/// - token: original operation cancellation ownership
/// - deadline: original absolute host deadline, forwarded to the transport
/// - Return: fully read validated declared success
/// # Errors
/// Declared rejection, a parameter without a wire form, or communication failure
/// # Panics
/// A response identity or payload that violates the declared contract`;

/** Deferred real HTTP consumer operation
 * @param ctx - Resolved generation context
 * @param operation - Canonical operation
 * @returns Generated standard Future entry point, or an empty string without an HTTP binding
 */
export function renderHttp(ctx: RustContext, operation: Operation): string {
  const binding = operation.http;
  const input = node(ctx, operation.input);
  if (binding === undefined || input.kind !== "object") return "";
  const op = snake(operation.name);
  const name = stem(operation);
  const routed = binding.parameters.some((mapping) => mapping.location === "path");
  const queried = binding.parameters.some((mapping) => mapping.location === "query");
  const headed = binding.parameters.some((mapping) => mapping.location === "header");
  const typed = operation.outcomes.some((outcome) => outcome.type !== undefined);
  return `${doc(operation.description, "Deferred HTTP operation with exact result selection")}
${httpContract}
pub async fn ${op}_http<T: HttpTransport>(transport: &T, input: ${input.name}, token: &CancellationToken, deadline: Option<Instant>) -> Result<Accepted<${name}Success>, OperationFailure<${name}Rejection>> {
    if token.is_cancelled() { return Err(OperationFailure::Cancelled); }
    let ${name}HttpRequest { ${binding.parameters.length > 0 ? "placements" : "placements: _"}, ${binding.body.kind === "none" ? "body: _" : "body"} } = encode_${op}_http_request(input);
    ${routed ? `let mut route = ${quote(binding.path)}.to_owned();` : `let route = ${quote(binding.path)};`}
    ${queried ? "let mut query: Vec<(&str, String)> = Vec::new();" : ""}
    let ${binding.body.kind !== "none" || headed ? "mut " : ""}headers = reqwest::header::HeaderMap::new();
    ${binding.parameters.map((mapping) => placement(mapping)).join("\n")}
    let Ok(${queried ? "mut " : ""}url) = transport.origin().join(${routed ? "&route" : "route"}) else { return Err(OperationFailure::Communication); };
    if !same_origin(&url, transport.origin()) { return Err(OperationFailure::Communication); }
    ${queried ? "if !query.is_empty() { let mut pairs = url.query_pairs_mut(); for (name, value) in query { pairs.append_pair(name, &value); } }" : ""}
    let mut request = reqwest::Request::new(reqwest::Method::${binding.method}, url);
    ${binding.body.kind === "none" ? "" : `if let Some(body) = body { headers.insert(reqwest::header::CONTENT_TYPE, reqwest::header::HeaderValue::from_static(${quote(binding.requestMediaType)})); *request.body_mut() = Some(body.into()); }`}
    *request.headers_mut() = headers;
    let response = transport.send(request, token, deadline).await.map_err(OperationFailure::from)?;
    let gateway = matches!(response.status, 502..=504);
    ${typed ? "let binding = Binding::Http;" : ""}
    ${binding.results.map((mapping) => resultBranch(ctx, operation, mapping)).join("\n")}
    if gateway { Err(OperationFailure::Communication) } else { panic!("an HTTP response identity is not a declared result") }
}
`;
}
