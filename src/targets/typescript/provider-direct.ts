import type { Operation, Outcome } from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { operationStem } from "./operation-names.js";
import { indent, lines, quote, tsdoc, type SourcePart } from "./source-text.js";

/**
 * Switch over the cases of one result path
 * @param operation - Resolved operation
 * @param rejection - Whether to map expected rejections rather than successes
 * @param mapCase - Statement of one declared case
 * @returns Guarded switch, empty when the path has no declared case
 */
function resultBranch(
  operation: Operation,
  rejection: boolean,
  mapCase: (outcome: Outcome) => string,
): SourcePart {
  const cases = operation.outcomes
    .filter((outcome) => outcome.rejection === rejection)
    .map(mapCase);
  if (cases.length === 0) return [];
  const guard = rejection ? "result.isErr()" : "result.isOk()";
  const value = rejection ? "result.error" : "result.value";
  return [
    `if (${guard}) {`,
    `  const outcome = ${value};`,
    "  switch (outcome.case) {",
    indent(lines(cases), 2),
    "  }",
    "}",
  ];
}

/**
 * IPC envelope mapping and handling of one operation
 * @param operation - Resolved operation with an IPC binding
 * @returns Envelope mapping and handling functions
 */
export function ipcOperationSource(operation: Operation): string {
  const stem = operationStem(operation);
  const ipc = operation.ipc!;
  const envelope = (outcome: Outcome): string => {
    const tag = quote(ipc.results.find((entry) => entry.outcome === outcome.name)!.tag);
    const body =
      outcome.type === undefined
        ? `{ tag: ${tag} }`
        : `{ tag: ${tag}, body: wirePayload(C.${operation.name}Outcomes[${quote(outcome.name)}], outcome.value, "ipc") }`;
    return `case ${quote(outcome.name)}: return C.stringifyJson(${body});`;
  };
  return lines(
    tsdoc(`IPC response envelope of a ${operation.name} handler result`, {
      params: [["result", "Handler success or declared rejection"]],
      returns: "Exact JSON envelope with the declared result tag",
      throws: ["C.ContractDefect", "Result outside the declared cases or with an invalid payload"],
    }),
    `function respond${stem}Ipc(result: Result<C.${stem}Success, C.${stem}Rejection>): string {`,
    indent(
      lines(
        resultBranch(operation, false, envelope),
        resultBranch(operation, true, envelope),
        'throw new C.ContractDefect("Unknown handler outcome");',
      ),
    ),
    "}",
    "",
    tsdoc(`Complete ${operation.name} IPC handling through provider acceptance`, {
      params: [
        ["parts", "Provider collaborators"],
        ["parametersJson", "Complete exact JSON parameters"],
        ["env", "Handwritten adapter capabilities"],
        ["context", "Host cancellation and deadline"],
      ],
      returns: "Encoded declared result with input diagnostics or the typed inbound failure",
      throws: ["C.ContractDefect", "Handler result outside the contract"],
    }),
    `async function handle${stem}Ipc<Env>(parts: ProviderParts<Env>, parametersJson: string, env: Env, context: C.CallContext): Promise<Result<C.Accepted<string>, InvalidInput>> {`,
    "  const parsed = C.parseJson(parametersJson);",
    "  if (parsed.isErr()) return invalidInput(parsed.error);",
    `  const accepted = C.accept${stem}(parsed.value, "ipc");`,
    "  if (accepted.isErr()) return invalidInput(accepted.error);",
    "  context.signal.throwIfAborted();",
    `  const result = await parts.handlers.${operation.name}(accepted.value.value)(env, context.signal, context.deadlineAt);`,
    `  return Ok(Object.freeze({ value: respond${stem}Ipc(result), diagnostics: accepted.value.diagnostics }));`,
    "}",
  );
}

/**
 * Command dispatch cases of the IPC operations
 * @param operations - Operations published over IPC
 * @returns One delegation case per command in stable order
 */
export function ipcDispatchCases(operations: readonly Operation[]): readonly string[] {
  return [...operations]
    .sort((a, b) => compareText(a.id, b.id))
    .map(
      (operation) =>
        `case ${quote(operation.ipc!.command)}: return handle${operationStem(operation)}Ipc(parts, parametersJson, env, context);`,
    );
}

/**
 * Direct call through provider acceptance of one operation
 * @param operation - Resolved operation
 * @param inputName - Public name of the operation parameter declaration
 * @returns Result validation and direct call functions
 */
export function directOperationSource(operation: Operation, inputName: string): string {
  const stem = operationStem(operation);
  const validate = (outcome: Outcome): string => {
    const name = quote(outcome.name);
    const wrap = outcome.rejection ? "Err" : "Ok";
    const value =
      outcome.type === undefined
        ? `{ case: ${name} as const }`
        : `{ case: ${name} as const, value: checkedPayload(C.${operation.name}Outcomes[${name}], outcome.value) }`;
    return `case ${name}: return ${wrap}(Object.freeze(${value}));`;
  };
  return lines(
    tsdoc(`Contract validation of a ${operation.name} handler result`, {
      params: [["result", "Handler success or declared rejection"]],
      returns: "Result with owned validated payloads",
      throws: ["C.ContractDefect", "Result outside the declared cases or with an invalid payload"],
    }),
    `function validate${stem}(result: Result<C.${stem}Success, C.${stem}Rejection>): Result<C.${stem}Success, C.${stem}Rejection> {`,
    indent(
      lines(
        resultBranch(operation, false, validate),
        resultBranch(operation, true, validate),
        'throw new C.ContractDefect("Unknown handler outcome");',
      ),
    ),
    "}",
    "",
    tsdoc(`Direct ${operation.name} call through provider acceptance`, {
      params: [
        ["parts", "Provider collaborators"],
        ["input", "Local input without defaults"],
        ["env", "Handwritten adapter capabilities"],
        ["context", "Host cancellation and deadline"],
      ],
      returns: "Declared result or input violations",
      throws: ["C.ContractDefect", "Handler result outside the contract"],
    }),
    `async function call${stem}<Env>(parts: ProviderParts<Env>, input: C.${inputName}, env: Env, context: C.CallContext): Promise<Result<C.${stem}Success, C.${stem}Rejection | InvalidInput>> {`,
    "  context.signal.throwIfAborted();",
    `  const accepted = C.accept${stem}(input);`,
    "  if (accepted.isErr()) return invalidInput(accepted.error);",
    `  const result = await parts.handlers.${operation.name}(accepted.value.value)(env, context.signal, context.deadlineAt);`,
    `  return validate${stem}(result);`,
    "}",
  );
}
