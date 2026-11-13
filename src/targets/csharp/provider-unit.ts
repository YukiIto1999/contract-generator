import { acceptedType } from "./acceptance.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { httpCommon, httpProviderSupport } from "./http-support.js";
import { lines, name, pascal, quote } from "./naming.js";
import { opName } from "./outcome-codecs.js";
import { renderHttpProvider } from "./provider-http.js";
import { renderDirect, renderIpcProvider } from "./provider-calls.js";

/** Handler interface that the handwritten adapter implements
 * @param c - Target context
 * @returns Interface declaration
 */
function handlerInterface(c: CSharpContext): string {
  return lines(
    doc("Contract-side adapter effect requirements"),
    "public interface IContractHandlers : IEffectRequirements {",
    ...c.model.operations.map((operation) =>
      lines(
        doc(
          operation.description || `Accepted ${operation.name} dispatch to a handwritten adapter`,
          ["input"],
          "Typed success or declared rejection",
        ),
        `Effect<NoRequirements, ${opName(operation, "Rejection")}, ${opName(operation, "Success")}> ${name(pascal(operation.name))}(${acceptedType(c, operation)} input);`,
      ),
    ),
    "}",
  );
}

/** Failures that the host turns into its own response
 * @param c - Target context
 * @returns Closed failure hierarchy
 */
function providerFailure(c: CSharpContext): string {
  return lines(
    doc("Typed provider dispatch failures that the host answers itself"),
    "[Closed] public abstract record ProviderFailure {",
    doc("Closed provider failure completion"),
    "private ProviderFailure() { }",
    doc("Route or command that no operation declares"),
    "public sealed record UnknownOperation : ProviderFailure;",
    ...c.model.operations.map((operation) =>
      lines(
        doc(`Expected failure of ${operation.name}`, [
          ["Failure", "Typed failure of the operation"],
        ]),
        `public sealed record ${name(pascal(operation.name))}(${opName(operation, "Failure")} Failure) : ProviderFailure;`,
      ),
    ),
    "}",
  );
}

/** Command dispatch of the IPC-published operations
 * @param c - Target context
 * @returns Dispatch method
 */
function dispatchIpc(c: CSharpContext): string {
  return lines(
    doc(
      "Injected IPC command dispatch",
      ["command", "parameters"],
      "Resolved response envelope or typed failure that the host answers",
    ),
    "public static Effect<IContractHandlers, ProviderFailure, string> DispatchIpc(string command, string parameters) {",
    ...c.model.operations
      .filter((operation) => operation.ipc)
      .map(
        (operation) =>
          `if (command == ${quote(operation.ipc!.command)}) return ${name(pascal(operation.name) + "Ipc")}(parameters).MapFailure(f => (ProviderFailure)new ProviderFailure.${name(pascal(operation.name))}(f));`,
      ),
    "return new EffectContext<IContractHandlers, ProviderFailure>().Fail<string>(new ProviderFailure.UnknownOperation());",
    "}",
  );
}

/** Route dispatch of the HTTP-published operations
 * @param c - Target context
 * @returns Dispatch method
 */
function dispatchHttp(c: CSharpContext): string {
  return lines(
    doc(
      "Native HTTP route dispatch",
      ["request"],
      "Native response or typed failure that the host answers",
    ),
    "public static Effect<IContractHandlers, ProviderFailure, HttpResponseMessage> DispatchHttp(HttpRequestMessage request) {",
    ...c.model.operations
      .filter((operation) => operation.http)
      .map(
        (operation) =>
          `if (request.Method.Method == ${quote(operation.http!.method)} && request.RequestUri is not null && HttpWire.Route(${quote(operation.http!.path)}, request.RequestUri.AbsolutePath, out _)) return ${name(pascal(operation.name) + "Http")}(request).MapFailure(f => (ProviderFailure)new ProviderFailure.${name(pascal(operation.name))}(f));`,
      ),
    "return new EffectContext<IContractHandlers, ProviderFailure>().Fail<HttpResponseMessage>(new ProviderFailure.UnknownOperation());",
    "}",
  );
}

/** Provider declarations and real binding dispatch
 * @param c - Target context
 * @returns Provider source
 */
export function renderProvider(c: CSharpContext): string {
  return lines(
    handlerInterface(c),
    providerFailure(c),
    httpCommon,
    httpProviderSupport,
    doc("Generated provider acceptance and dispatch"),
    "public static class ContractProvider {",
    ...c.model.operations.map((operation) =>
      lines(
        renderDirect(c, operation),
        operation.ipc ? renderIpcProvider(c, operation) : "",
        operation.http ? renderHttpProvider(c, operation) : "",
      ),
    ),
    dispatchIpc(c),
    dispatchHttp(c),
    "}",
  );
}
