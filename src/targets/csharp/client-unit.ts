import { renderHttpClient } from "./client-http.js";
import { renderIpcClient } from "./client-ipc.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { httpClientSupport, httpCommon } from "./http-support.js";
import { renderHttpTransport } from "./http-transport.js";
import { lines } from "./naming.js";

/** Injected native HTTP and IPC client
 * @param c - Target context
 * @returns Client unit declarations
 */
export function renderClient(c: CSharpContext): string {
  return lines(
    renderHttpTransport(),
    doc("Caller-owned IPC communication effect"),
    "public interface IIpcTransport {",
    doc(
      "Native cancellable command invocation",
      [
        "command",
        "parameters",
        "deadline",
        ["cancellationToken", "Runtime-owned cancellation notification"],
      ],
      "Resolved JSON envelope or expected communication failure",
    ),
    "ValueTask<Result<string, CommunicationFailure>> Invoke(string command, string parameters, global::EffectSystem.Domain.Deadline deadline, CancellationToken cancellationToken);",
    "}",
    doc("Injected client communication requirements"),
    "public interface IClientRequirements : IEffectRequirements {",
    doc("Caller-owned native HTTP transport", [], undefined, {
      value: "Configured connection and authentication ownership that follows no redirect",
    }),
    "IHttpTransport Http { get; }",
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
    `public static readonly HttpRequestOptionsKey<global::EffectSystem.Domain.Deadline> DeadlineOption = new("ContractDeadline");`,
    ...c.model.operations.flatMap((operation) => [
      operation.http ? renderHttpClient(c, operation) : "",
      operation.ipc ? renderIpcClient(c, operation) : "",
    ]),
    "}",
  );
}
