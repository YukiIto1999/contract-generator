import { renderHttp } from "./client-http.js";
import { renderIpc } from "./client-ipc.js";
import type { RustContext } from "./context.js";
import { reachable, support, type Support } from "./support.js";

/** Response and placement helpers retained only for operations whose HTTP binding reaches them */
const clientSupport: readonly Support[] = [
  support(
    "single_header",
    String.raw`/// Singleton response header selection without accepting conflicting duplicates
///
/// - headers: case-insensitive native response headers
/// - name: generated header name
/// - Return: exact singleton text value
fn single_header<'a>(headers: &'a reqwest::header::HeaderMap, name: &str) -> Option<&'a str> {
    let mut values = headers.get_all(name).iter();
    let value = values.next()?.to_str().ok()?;
    if values.next().is_some() { None } else { Some(value) }
}
`,
  ),
  support(
    "path_segment",
    String.raw`/// Percent encoding of a single path parameter
///
/// - value: scalar text
/// - Return: unambiguous path segment, or none for the empty text and the dot segments that no segment carries unchanged
fn path_segment(value: &str) -> Option<String> {
    if matches!(value, "" | "." | "..") { return None; }
    Some(url::form_urlencoded::byte_serialize(value.as_bytes()).collect::<String>().replace('+', "%20"))
}
`,
  ),
  support(
    "same_origin",
    String.raw`/// Origin identity of a constructed request URL
///
/// - url: constructed request URL
/// - origin: service origin supplied by the host
/// - Return: whether scheme, host and port are those of the service origin
fn same_origin(url: &reqwest::Url, origin: &reqwest::Url) -> bool {
    url.scheme() == origin.scheme() && url.host() == origin.host() && url.port_or_known_default() == origin.port_or_known_default()
}
`,
  ),
];

/** Fully read response and the injected and bundled HTTP transports */
const httpTransport = String.raw`/// Fully read HTTP response without text conversion
pub struct HttpResponse {
    /// Exact received status
    pub status: u16,
    /// Case-insensitive received headers
    pub headers: reqwest::header::HeaderMap,
    /// Raw complete bytes including an empty binary payload
    pub body: bytes::Bytes,
}
/// Injected HTTP execution; the host owns every deadline policy and the transport follows no redirect
pub trait HttpTransport: Send + Sync {
    /// Borrowed service origin supplied by the host
    ///
    /// - self: connection owner
    /// - Return: service origin
    fn origin(&self) -> &reqwest::Url;
    /// Deferred request execution including complete body consumption
    ///
    /// - self: native connection owner
    /// - request: generated request
    /// - token: original operation cancellation
    /// - deadline: original host deadline, enforced only by the host
    /// - Return: fully read native response; a redirect status is returned as the response and never followed, because a generated request must not reach another origin
    /// # Errors
    /// Native communication termination, cancellation or host-enforced deadline expiry
    fn send(&self, request: reqwest::Request, token: &CancellationToken, deadline: Option<Instant>) -> impl Future<Output = Result<HttpResponse, CommunicationFailure>> + Send;
}
/// Concrete reqwest transport that follows no redirect
pub struct ReqwestTransport {
    /// Native HTTP client built by this transport
    client: reqwest::Client,
    /// Injected service origin
    origin: reqwest::Url,
}
impl ReqwestTransport {
    /// Client construction from the host connection configuration with redirect following disabled
    ///
    /// - builder: native client configuration of the host; its redirect policy is replaced
    /// - origin: service origin
    /// - Return: real HTTP transport that owns the built client
    /// # Errors
    /// Native client construction failure
    pub fn new(builder: reqwest::ClientBuilder, origin: reqwest::Url) -> Result<Self, reqwest::Error> {
        Ok(Self { client: builder.redirect(reqwest::redirect::Policy::none()).build()?, origin })
    }
}
impl HttpTransport for ReqwestTransport {
    fn origin(&self) -> &reqwest::Url { &self.origin }
    /// Request execution that forwards cancellation by dropping the request future and adds no timer
    ///
    /// - self: bundled transport
    /// - request: generated request
    /// - token: original operation cancellation
    /// - deadline: not enforced; the host wraps the transport to enforce a deadline
    /// - Return: fully read native response
    /// # Errors
    /// Connection failure, interrupted response body or cancellation
    async fn send(&self, request: reqwest::Request, token: &CancellationToken, _deadline: Option<Instant>) -> Result<HttpResponse, CommunicationFailure> {
        if token.is_cancelled() { return Err(CommunicationFailure::Cancelled); }
        let work = async {
            let mut response = self.client.execute(request).await.map_err(|_| CommunicationFailure::Failed)?;
            let status = response.status().as_u16();
            let headers = std::mem::take(response.headers_mut());
            let body = response.bytes().await.map_err(|_| CommunicationFailure::Failed)?;
            Ok(HttpResponse { status, headers, body })
        };
        tokio::select! { biased; result = work => result, () = token.cancelled() => Err(CommunicationFailure::Cancelled) }
    }
}
`;

/** Rust consumer dependency unit using injected existing transports
 * @param ctx - Resolved rendering context
 * @returns Complete client crate source
 */
export function renderClient(ctx: RustContext): string {
  const prefix = ctx.prefix.replace(/-/g, "_");
  const operations = ctx.model.operations
    .map((operation) => renderIpc(ctx, operation) + renderHttp(ctx, operation))
    .join("\n");
  const body = `//! Deferred contract consumers over real HTTP and injected IPC
use ${prefix}_types::*;
pub use ${prefix}_transport::*;
use std::future::Future;
${httpTransport}${operations}`;
  return body + reachable(body, clientSupport);
}
