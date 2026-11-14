import { doc } from "./docs.js";
import { lines } from "./naming.js";

/** Description of the cancellation parameter that the transport contract shares with its bundled implementation */
const cancellation = ["cancellationToken", "Runtime-owned cancellation notification"] as const;

/** Native HTTP transport contract and its bundled SocketsHttpHandler implementation
 * @returns Consumer unit declarations
 */
export function renderHttpTransport(): string {
  return lines(
    doc(
      "Caller-owned HTTP exchange that follows no redirect, because a generated request never leaves the service origin",
    ),
    "public interface IHttpTransport {",
    doc(
      "Native request execution that completes when the response headers are available and returns a redirect status unfollowed",
      ["request", cancellation],
      "Received response, which the caller disposes",
      { throws: [["HttpRequestException", "No response could be obtained"]] },
    ),
    "ValueTask<HttpResponseMessage> Send(HttpRequestMessage request, CancellationToken cancellationToken);",
    "}",
    doc(
      "Native transport over a SocketsHttpHandler that it creates, configures once and owns for its lifetime, without an HttpClient timeout or response buffering",
    ),
    "public sealed class SocketsHttpTransport : IHttpTransport, IDisposable {",
    doc("Request execution over the owned handler"),
    "private readonly HttpMessageInvoker invoker;",
    doc("Handler creation, host configuration and redirect disablement, in that order", [
      [
        "configure",
        "Host configuration of the new handler; it must not retain or later change the handler, whose redirect following is disabled after it returns",
      ],
    ]),
    "public SocketsHttpTransport(Action<SocketsHttpHandler>? configure = null) {",
    "var handler = new SocketsHttpHandler();",
    "try {",
    "configure?.Invoke(handler);",
    "handler.AllowAutoRedirect = false;",
    "invoker = new HttpMessageInvoker(handler, disposeHandler: true);",
    "} catch { handler.Dispose(); throw; }",
    "}",
    doc(
      "Request execution over the owned handler",
      ["request", cancellation],
      "Received response, which the caller disposes",
      {
        throws: [["HttpRequestException", "No response could be obtained"]],
      },
    ),
    "public ValueTask<HttpResponseMessage> Send(HttpRequestMessage request, CancellationToken cancellationToken) => new(invoker.SendAsync(request, cancellationToken));",
    doc("Release of the owned handler and its connections"),
    "public void Dispose() => invoker.Dispose();",
    "}",
  );
}
