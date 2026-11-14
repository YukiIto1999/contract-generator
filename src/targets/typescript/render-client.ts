import type { ContractModel, Operation } from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import {
  headerHelperSource,
  httpHelperSource,
  ipcHelperSource,
  payloadSource,
  queryHelperSource,
  transportSource,
} from "./client-support.js";
import {
  classificationSource,
  httpExchangeSource,
  inputName,
  ipcExchangeSource,
} from "./client-operations.js";
import { requestSource } from "./client-request.js";
import { operationStem } from "./operation-names.js";
import { indent, lines, quote, tsdoc } from "./source-text.js";

/**
 * Deferred client method of one operation over one binding
 * @param model - Contract with target-safe names
 * @param operation - Resolved operation
 * @param binding - Binding the method calls through
 * @returns Effect factory method delegating to `deferEffect`
 */
function methodSource(model: ContractModel, operation: Operation, binding: "Http" | "Ipc"): string {
  const stem = operationStem(operation);
  const input = inputName(new Map(model.types.map((type) => [type.id, type])), operation);
  return lines(
    tsdoc(`Deferred ${operation.name} ${binding.toUpperCase()} call`, {
      params: [["input", "Input without provider default application"]],
      returns:
        "Caller-owned deferred Effect whose awaited result rejects with a contract defect for invalid input or a mismatching response",
    }),
    `${operation.name}(input: C.${input}): Effect<unknown, C.${stem}Rejection | C.CommunicationFailure, C.${stem}Success> {`,
    `  return deferEffect((_env, signal, deadlineAt) => new AsyncResult(send${stem}${binding}(options, input, { signal, deadlineAt })));`,
    "}",
  );
}

/**
 * Client factory over one binding
 * @param name - Factory name
 * @param binding - Binding of the client
 * @param operations - Operations published over the binding
 * @param model - Contract with target-safe names
 * @returns Exported factory returning typed deferred methods
 */
function factorySource(
  name: string,
  binding: "Http" | "Ipc",
  operations: readonly Operation[],
  model: ContractModel,
): string {
  const methods = operations.map((operation) => methodSource(model, operation, binding));
  return lines(
    tsdoc(`${binding.toUpperCase()} client without eager validation or I/O`, {
      params: [
        ["options", binding === "Http" ? "Host origin and transport" : "Injected IPC mechanism"],
      ],
      returns: "Typed deferred operation methods",
    }),
    `export function ${name}(options: ${binding}ClientOptions) {`,
    "  return {",
    indent(methods.join(",\n"), 2),
    "  };",
    "}",
  );
}

/**
 * Real injected transport client emission
 * @param model - Contract with target-safe names
 * @param effectModule - Caller-owned module exporting the Effect type and `deferEffect`
 * @returns Client-only module
 */
export function renderClient(model: ContractModel, effectModule: string): string {
  if (model.operations.length === 0) return "export {};\n";
  const types = new Map(model.types.map((type) => [type.id, type]));
  const operations = [...model.operations].sort((a, b) => compareText(a.id, b.id));
  const http = operations.filter((operation) => operation.http !== undefined);
  const ipc = operations.filter((operation) => operation.ipc !== undefined);
  const placed = http.flatMap((operation) =>
    operation.http!.parameters.map((parameter) => parameter.location),
  );
  const sections = [
    `import { AsyncResult, Err, Ok, Result } from "ts-results-es";\nimport { deferEffect, type Effect } from ${quote(effectModule)};\nimport * as C from "./contract.js";\n`,
    transportSource,
    payloadSource,
    http.length > 0 && httpHelperSource,
    placed.includes("query") && queryHelperSource,
    placed.includes("header") && headerHelperSource,
    ipc.length > 0 && ipcHelperSource,
    ...operations.map(classificationSource),
    ...http.map((operation) => requestSource(types, operation, operation.http!)),
    ...http.map((operation) => httpExchangeSource(types, operation, operation.http!)),
    ...ipc.map((operation) => ipcExchangeSource(types, operation)),
    http.length > 0 && factorySource("createHttpClient", "Http", http, model),
    ipc.length > 0 && factorySource("createIpcClient", "Ipc", ipc, model),
  ];
  return sections.filter((section) => section !== false).join("\n\n") + "\n";
}
