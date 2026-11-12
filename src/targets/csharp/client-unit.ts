import { renderHttpClient } from "./client-http.js";
import { renderIpcClient } from "./client-ipc.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { httpClientSupport, httpCommon } from "./http-support.js";
import { lines } from "./naming.js";

/** Injected native HTTP and IPC client
 * @param c - Target context
 * @returns Client unit declarations
 */
export function renderClient(c: CSharpContext): string {
  return lines(
    doc("Caller-owned IPC communication effect"),
    "public interface IIpcTransport {",
    doc(
      "Native cancellable command invocation",
      ["command", "parameters", "deadline"],
      "Resolved JSON envelope or expected communication failure",
    ),
    "Effect<NoRequirements, CommunicationFailure, string> Invoke(string command, string parameters, DateTimeOffset? deadline);",
    "}",
    doc("Injected client communication requirements"),
    "public interface IClientRequirements : IEffectRequirements {",
    doc("Caller-owned native HTTP client", [], undefined, {
      value: "Configured connection and authentication ownership",
    }),
    "HttpClient HttpClient { get; }",
    doc("Caller-owned service origin", [], undefined, { value: "Absolute HTTP service origin" }),
    "Uri ServiceOrigin { get; }",
    doc("Caller-owned IPC transport", [], undefined, {
      value: "Native cancellable IPC implementation",
    }),
    "IIpcTransport Ipc { get; }",
    "}",
    httpCommon,
    httpClientSupport,
    doc("Generated consumer operations that never apply provider defaults"),
    "public static class ContractClient {",
    doc("Caller-visible native request deadline metadata", [], undefined, {
      value: "Option key that carries the host deadline on each request",
    }),
    `public static readonly HttpRequestOptionsKey<DateTimeOffset?> DeadlineOption = new("ContractDeadline");`,
    ...c.model.operations.flatMap((operation) => [
      operation.http ? renderHttpClient(c, operation) : "",
      operation.ipc ? renderIpcClient(c, operation) : "",
    ]),
    "}",
  );
}
