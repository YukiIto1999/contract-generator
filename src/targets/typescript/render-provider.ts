import type { ContractModel, Operation } from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { inputName } from "./client-operations.js";
import { directOperationSource, ipcDispatchCases, ipcOperationSource } from "./provider-direct.js";
import { httpDispatchStatements, httpOperationSource } from "./provider-http.js";
import { providerCoreSource, providerHttpSource } from "./provider-support.js";
import { operationStem } from "./operation-names.js";
import { docText, indent, lines, quote, tsdoc } from "./source-text.js";

/**
 * Handler interface of the handwritten adapter
 * @param operations - Operations in stable order
 * @returns Exported interface with one documented method per operation
 */
function handlersSource(operations: readonly Operation[]): string {
  const methods = operations.map((operation) => {
    const stem = operationStem(operation);
    return lines(
      tsdoc(docText(operation.description, "Accepted contract operation"), {
        params: [["input", "Effective provider-accepted immutable parameters"]],
        returns: "Declared success or declared expected rejection",
      }),
      `${operation.name}(input: C.${stem}AcceptedInput): Effect<Env, C.${stem}Rejection, C.${stem}Success>;`,
    );
  });
  return lines(
    tsdoc("Contract-side adapter interface without application implementation inheritance", {
      typeParams: [["Env", "Handwritten adapter capabilities"]],
    }),
    "export interface Handlers<Env> {",
    indent(methods.join("\n\n")),
    "}",
  );
}

/**
 * Dispatch function over the operations of one binding
 * @param http - Operations published over HTTP
 * @returns Route dispatch function
 */
function httpDispatchSource(http: readonly Operation[]): string {
  return lines(
    tsdoc("Route dispatch of an inbound HTTP request", {
      params: [
        ["parts", "Provider collaborators"],
        ["request", "Host request"],
        ["env", "Handwritten adapter capabilities"],
        ["context", "Host cancellation and deadline"],
      ],
      returns: "Declared response with input diagnostics or the typed inbound failure",
      throws: ["C.ContractDefect", "Handler result outside the contract"],
    }),
    "async function dispatchHttp<Env>(parts: ProviderParts<Env>, request: Request, env: Env, context: C.CallContext): Promise<Result<C.Accepted<Response>, HttpFailure>> {",
    "  context.signal.throwIfAborted();",
    "  const url = new URL(request.url);",
    indent(lines(httpDispatchStatements(http))),
    '  return Err<NotFound>({ kind: "not-found" });',
    "}",
  );
}

/**
 * Command dispatch function of the IPC operations
 * @param ipc - Operations published over IPC
 * @returns Command dispatch function
 */
function ipcDispatchSource(ipc: readonly Operation[]): string {
  return lines(
    tsdoc("Command dispatch of an inbound IPC message", {
      params: [
        ["parts", "Provider collaborators"],
        ["command", "Binding command"],
        ["parametersJson", "Complete exact JSON parameters"],
        ["env", "Handwritten adapter capabilities"],
        ["context", "Host cancellation and deadline"],
      ],
      returns: "Encoded declared result with input diagnostics or the typed inbound failure",
      throws: ["C.ContractDefect", "Handler result outside the contract"],
    }),
    "async function dispatchIpc<Env>(parts: ProviderParts<Env>, command: string, parametersJson: string, env: Env, context: C.CallContext): Promise<Result<C.Accepted<string>, InvalidInput | NotFound>> {",
    "  context.signal.throwIfAborted();",
    "  switch (command) {",
    indent(lines(ipcDispatchCases(ipc)), 2),
    '    default: return Err<NotFound>({ kind: "not-found" });',
    "  }",
    "}",
  );
}

/**
 * Binding entrypoint methods of the provider
 * @param bindings - Which binding entrypoints the contract publishes
 * @returns Documented deferred methods for the published bindings
 */
function bindingMethods(bindings: { readonly http: boolean; readonly ipc: boolean }): string[] {
  const http = lines(
    tsdoc("Deferred HTTP routing through provider acceptance", {
      params: [["request", "Host HTTP request"]],
      returns:
        "Caller-owned deferred Effect of the declared response with input diagnostics or the typed inbound failure",
    }),
    "handleHttp(request: Request): Effect<Env, HttpFailure, C.Accepted<Response>> {",
    "  return deferEffect((env, signal, deadlineAt) => new AsyncResult(dispatchHttp(parts, request, env, { signal, deadlineAt })));",
    "}",
  );
  const ipc = lines(
    tsdoc("Deferred supplied-transport IPC dispatch", {
      params: [
        ["command", "Binding command"],
        ["parametersJson", "Complete exact JSON parameters"],
      ],
      returns:
        "Caller-owned deferred Effect of the encoded declared result with input diagnostics or the typed inbound failure",
    }),
    "handleIpc(command: string, parametersJson: string): Effect<Env, InvalidInput | NotFound, C.Accepted<string>> {",
    "  return deferEffect((env, signal, deadlineAt) => new AsyncResult(dispatchIpc(parts, command, parametersJson, env, { signal, deadlineAt })));",
    "}",
  );
  return [...(bindings.http ? [http] : []), ...(bindings.ipc ? [ipc] : [])];
}

/**
 * Provider factory returning direct and binding entrypoints
 * @param model - Contract with target-safe names
 * @param operations - Operations in stable order
 * @param bindings - Which binding entrypoints the contract publishes
 * @returns Exported factory
 */
function factorySource(
  model: ContractModel,
  operations: readonly Operation[],
  bindings: { readonly http: boolean; readonly ipc: boolean },
): string {
  const types = new Map(model.types.map((type) => [type.id, type]));
  const direct = operations.map((operation) => {
    const stem = operationStem(operation);
    return lines(
      tsdoc(`Deferred direct ${operation.name} call through provider acceptance`, {
        params: [["input", "Local input without defaults"]],
        returns: "Caller-owned deferred Effect of the declared result or input violations",
      }),
      `${operation.name}(input: C.${inputName(types, operation)}): Effect<Env, C.${stem}Rejection | InvalidInput, C.${stem}Success> {`,
      `  return deferEffect((env, signal, deadlineAt) => new AsyncResult(call${stem}(parts, input, env, { signal, deadlineAt })));`,
      "}",
    );
  });
  return lines(
    tsdoc("Provider creation without eager user work", {
      typeParams: [["Env", "Handwritten adapter capabilities"]],
      params: [
        ["handlers", "Handwritten application adapters"],
        ["readBody", "Host-owned body reading and failure classification"],
      ],
      returns: "Direct and binding operation effects",
    }),
    "export function createProvider<Env>(handlers: Handlers<Env>, readBody: RequestBodyReader) {",
    "  const parts: ProviderParts<Env> = { handlers, readBody };",
    "  return {",
    indent([...direct, ...bindingMethods(bindings)].join(",\n"), 2),
    "  };",
    "}",
  );
}

/**
 * Provider acceptance and real binding dispatch emission
 * @param model - Contract with target-safe names
 * @param effectModule - Caller-owned module exporting the Effect type and `deferEffect`
 * @returns Provider-only module
 */
export function renderProvider(model: ContractModel, effectModule: string): string {
  if (model.operations.length === 0) return "export {};\n";
  const types = new Map(model.types.map((type) => [type.id, type]));
  const operations = [...model.operations].sort((a, b) => compareText(a.id, b.id));
  const http = operations.filter((operation) => operation.http !== undefined);
  const ipc = operations.filter((operation) => operation.ipc !== undefined);
  const sections = [
    `import { AsyncResult, Err, Ok, Result } from "ts-results-es";\nimport { deferEffect, type Effect } from ${quote(effectModule)};\nimport * as C from "./contract.js";\n`,
    handlersSource(operations),
    providerCoreSource,
    http.length > 0 && providerHttpSource,
    ...http.map((operation) => httpOperationSource(types, operation, operation.http!)),
    ...ipc.map(ipcOperationSource),
    ...operations.map((operation) => directOperationSource(operation, inputName(types, operation))),
    http.length > 0 && httpDispatchSource(http),
    ipc.length > 0 && ipcDispatchSource(ipc),
    factorySource(model, operations, { http: http.length > 0, ipc: ipc.length > 0 }),
  ];
  return sections.filter((section) => section !== false).join("\n\n") + "\n";
}
