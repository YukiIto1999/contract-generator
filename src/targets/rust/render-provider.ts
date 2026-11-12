import type { Operation } from "../../model/contract-model.js";
import type { RustContext } from "./context.js";
import { doc, snake, stem } from "./naming.js";
import { renderDirect } from "./provider-direct.js";
import { httpBranch, renderHttp } from "./provider-http.js";
import { renderIpcDispatch } from "./provider-ipc.js";
import { providerSupport } from "./provider-support.js";
import { acceptedType } from "./render-acceptance.js";
import { reachable } from "./support.js";

/** Adapter-owned handler method of one operation
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Rust trait method declaration
 */
function handlerMethod(ctx: RustContext, operation: Operation): string {
  const name = stem(operation);
  return `${doc(operation.description, "Accepted contract operation implemented by a hand-written adapter")}
///
/// - self: contract adapter
/// - input: effective accepted parameters with provider defaults
/// - token: original cooperative cancellation
/// - deadline: original absolute host deadline
/// - Return: declared success or typed rejection
/// # Errors
/// Declared rejection or cancellation after owned cleanup
fn ${snake(operation.name)}(&self, input: ${acceptedType(ctx, operation)}, token: &CancellationToken, deadline: Option<Instant>) -> impl Future<Output = Result<${name}Success, HandlerFailure<${name}Rejection>>> + Send;`;
}

/** Native HTTP route dispatch across every operation published over HTTP
 * @param ctx - Rendering context
 * @returns Rust dispatch function, or an empty string when no operation is published over HTTP
 */
function httpDispatch(ctx: RustContext): string {
  const branches = ctx.model.operations.map((operation) => httpBranch(operation)).join("\n");
  if (branches.trim() === "") return "";
  return `/// Native HTTP route dispatch to the operation published for the request method and path
///
/// - handler: hand-written contract adapter
/// - request: actual native HTTP request
/// - token: original host cancellation
/// - deadline: original absolute host deadline
/// - Return: exact declared HTTP response with input diagnostics
/// # Errors
/// Invalid request, no published method and route, interrupted request body or cooperative cancellation
pub async fn dispatch_http<H: Handler>(handler: &H, request: axum::http::Request<axum::body::Body>, token: &CancellationToken, deadline: Option<Instant>) -> Result<Accepted<axum::response::Response>, ProviderFailure> {
    if token.is_cancelled() { return Err(ProviderFailure::Cancelled); }
    let method = request.method().as_str().to_owned();
    let path = request.uri().path().to_owned();
    let (method, path) = (method.as_str(), path.as_str());
    ${branches}
    Err(ProviderFailure::UnknownOperation)
}
`;
}

/** Provider crate with typed adapters and typed dispatch results for the host
 * @param ctx - Resolved generation context
 * @returns Complete provider source
 */
export function renderProvider(ctx: RustContext): string {
  const prefix = ctx.prefix.replace(/-/g, "_");
  const methods = ctx.model.operations.map((operation) => handlerMethod(ctx, operation));
  const operations = ctx.model.operations
    .map((operation) => renderDirect(ctx, operation) + renderHttp(ctx, operation))
    .join("\n");
  const body = `//! Contract-side adapter interfaces and generated provider dispatch
use ${prefix}_types::*;
pub use ${prefix}_transport::*;
use serde_json::Value;
use std::future::Future;
/// Adapter-owned implementation of generated public contract operations
pub trait Handler: Send + Sync + 'static {
${methods.join("\n")}
}
${operations}
${renderIpcDispatch(ctx)}${httpDispatch(ctx)}`;
  return body + reachable(body, providerSupport);
}
