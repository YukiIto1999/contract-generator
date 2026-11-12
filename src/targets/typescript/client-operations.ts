import type { HttpBinding, HttpResult } from "../../model/binding-model.js";
import type { ContractType, Operation, Outcome } from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { operationStem } from "./operation-names.js";
import { carriesRawBytes, inputOf, mediaEssence } from "./operation-plan.js";
import { indent, lines, quote, tsdoc, type SourcePart } from "./source-text.js";

/** Declarations by stable identity */
type Types = ReadonlyMap<string, ContractType>;

/**
 * Failure union of an operation call
 * @param stem - Operation stem
 * @returns Declared rejections and communication failure
 */
function failureUnion(stem: string): string {
  return `C.${stem}Rejection | C.CommunicationFailure`;
}

/**
 * Result-case names and the shared classification of a received payload
 * @param operation - Resolved operation
 * @returns Case type and exhaustive classification function
 */
export function classificationSource(operation: Operation): string {
  const stem = operationStem(operation);
  const cases = operation.outcomes.map((outcome): SourcePart => {
    const name = quote(outcome.name);
    if (outcome.type === undefined)
      return `case ${name}: return Ok(Object.freeze({ case: ${name} as const }));`;
    const wrap = outcome.rejection ? "Err" : "Ok";
    return [
      `case ${name}: {`,
      `  const decoded = payload(C.${operation.name}Outcomes[${name}], body, binding, mismatch);`,
      `  return decoded.isErr() ? decoded : ${wrap}(Object.freeze({ case: ${name} as const, value: decoded.value }));`,
      "}",
    ];
  });
  return lines(
    tsdoc(`Declared ${operation.name} result cases`),
    `type ${stem}Case = C.${stem}Success["case"] | C.${stem}Rejection["case"];`,
    "",
    tsdoc(`Declared ${operation.name} result of a received payload`, {
      params: [
        ["selected", "Result case selected by metadata"],
        ["body", "Wire body of the selected result"],
        ["binding", "Binding interpretation"],
        ["mismatch", "Contract mismatch classification"],
      ],
      returns: "Declared success, declared rejection or the classified mismatch",
    }),
    `function classify${stem}(selected: ${stem}Case, body: unknown, binding: C.WireBinding, mismatch: Mismatch): Result<C.${stem}Success, ${failureUnion(stem)}> {`,
    "  switch (selected) {",
    indent(lines(cases), 2),
    "  }",
    "}",
  );
}

/**
 * Selection condition of one declared HTTP result
 * @param mapping - Declared response mapping
 * @returns Boolean expression over `response` and `mediaType`
 */
function selectionCondition(mapping: HttpResult): string {
  const media =
    mapping.mediaType === undefined
      ? 'response.headers.get("content-type") === null'
      : `mediaType === ${quote(mediaEssence(mapping.mediaType))}`;
  const headers = Object.entries(mapping.headers)
    .sort(([left], [right]) => compareText(left, right))
    .map(([name, value]) => `response.headers.get(${quote(name)}) === ${quote(value)}`);
  return [`response.status === ${mapping.status}`, media, ...headers].join(" && ");
}

/**
 * Wire body reading of the selected HTTP result
 * @param types - Declarations by stable identity
 * @param http - HTTP binding
 * @param outcome - Declared outcome
 * @returns Expression producing a Result of the wire body
 */
function bodyReading(types: Types, http: HttpBinding, outcome: Outcome): string {
  const mapping = http.results.find((entry) => entry.outcome === outcome.name);
  if (outcome.type === undefined) return "absentBody(bytes)";
  return carriesRawBytes(types, outcome.type, mapping?.mediaType)
    ? "Ok(bytes)"
    : "C.parseJsonBytes(bytes)";
}

/**
 * Metadata selection of the declared HTTP result
 * @param operation - Resolved operation
 * @param http - HTTP binding
 * @returns Selection function over status, media type and headers
 */
function httpSelectionSource(operation: Operation, http: HttpBinding): string {
  const stem = operationStem(operation);
  const selections = http.results.map(
    (mapping) => `if (${selectionCondition(mapping)}) return ${quote(mapping.outcome)};`,
  );
  return lines(
    tsdoc(`Declared ${operation.name} result selected by response metadata`, {
      params: [["response", "Received response"]],
      returns: "Case whose status, media type and headers match, absent otherwise",
    }),
    `function select${stem}Http(response: Response): ${stem}Case | undefined {`,
    '  const mediaType = essence(response.headers.get("content-type"));',
    indent(lines(selections)),
    "  return undefined;",
    "}",
  );
}

/**
 * Wire body reading of the selected HTTP result
 * @param types - Declarations by stable identity
 * @param operation - Resolved operation
 * @param http - HTTP binding
 * @returns Body reading function over the selected case
 */
function httpBodySource(types: Types, operation: Operation, http: HttpBinding): string {
  const stem = operationStem(operation);
  const readings = operation.outcomes.map(
    (outcome) => `case ${quote(outcome.name)}: return ${bodyReading(types, http, outcome)};`,
  );
  return lines(
    tsdoc(`Wire body of the selected ${operation.name} result`, {
      params: [
        ["selected", "Selected case"],
        ["bytes", "Complete response body"],
      ],
      returns: "Parsed JSON, raw bytes or the absent body, or violations",
    }),
    `function read${stem}Body(selected: ${stem}Case, bytes: Uint8Array): Result<unknown, readonly C.Violation[]> {`,
    "  switch (selected) {",
    indent(lines(readings), 2),
    "  }",
    "}",
  );
}

/**
 * HTTP selection, body reading and exchange of one operation
 * @param types - Declarations by stable identity
 * @param operation - Resolved operation
 * @param http - HTTP binding
 * @returns Selection, body reading and send functions
 */
export function httpExchangeSource(types: Types, operation: Operation, http: HttpBinding): string {
  const stem = operationStem(operation);
  const input = inputName(types, operation);
  return lines(
    httpSelectionSource(operation, http),
    "",
    httpBodySource(types, operation, http),
    "",
    tsdoc(`Deferred ${operation.name} HTTP exchange`, {
      params: [
        ["options", "Host origin and transport"],
        ["input", "Public client input"],
        ["context", "Host cancellation and deadline"],
      ],
      returns: "Declared success, declared rejection or communication failure",
      throws: ["C.ContractDefect", "Invalid input or a response that violates the contract"],
    }),
    `async function send${stem}Http(options: HttpClientOptions, input: C.${input}, context: C.CallContext): Promise<Result<C.${stem}Success, ${failureUnion(stem)}>> {`,
    "  context.signal.throwIfAborted();",
    `  const request = build${stem}Request(options.baseUrl, input, context.signal);`,
    "  if (request.isErr()) return request;",
    "  const sent = await options.transport.request(request.value, context);",
    "  if (sent.isErr()) return sent;",
    "  const response = sent.value;",
    "  const mismatch: Mismatch = (violations) => httpMismatch(response.status, violations);",
    `  const selected = select${stem}Http(response);`,
    "  if (selected === undefined) {",
    "    await discardBody(response);",
    "    return mismatch([]);",
    "  }",
    "  const received = await options.transport.readBody(response, context);",
    "  if (received.isErr()) return received;",
    `  const body = read${stem}Body(selected, received.value);`,
    "  if (body.isErr()) return mismatch(body.error);",
    `  return classify${stem}(selected, body.value, "http", mismatch);`,
    "}",
  );
}

/**
 * Public name of the operation parameter declaration
 * @param types - Declarations by stable identity
 * @param operation - Resolved operation
 * @returns Declaration name
 */
export function inputName(types: Types, operation: Operation): string {
  return inputOf(types, operation)!.name;
}

/**
 * IPC tag selection and exchange of one operation
 * @param types - Declarations by stable identity
 * @param operation - Resolved operation
 * @returns Tag selection and send functions
 */
export function ipcExchangeSource(types: Types, operation: Operation): string {
  const stem = operationStem(operation);
  const ipc = operation.ipc!;
  const tags = ipc.results.map(
    (mapping) => `case ${quote(mapping.tag)}: return ${quote(mapping.outcome)};`,
  );
  return lines(
    tsdoc(`Declared ${operation.name} result selected by the IPC tag`, {
      params: [["tag", "Result tag of the response envelope"]],
      returns: "Case of the tag",
      throws: ["C.ContractDefect", "Tag that no declared result uses"],
    }),
    `function select${stem}Ipc(tag: unknown): ${stem}Case {`,
    "  switch (tag) {",
    indent(lines(tags), 2),
    '    default: throw new C.ContractDefect("Unknown IPC result tag");',
    "  }",
    "}",
    "",
    tsdoc(`Deferred ${operation.name} IPC exchange`, {
      params: [
        ["options", "Injected IPC mechanism"],
        ["input", "Public client input"],
        ["context", "Host cancellation and deadline"],
      ],
      returns: "Declared success, declared rejection or communication failure",
      throws: ["C.ContractDefect", "Invalid input or a response that violates the contract"],
    }),
    `async function send${stem}Ipc(options: IpcClientOptions, input: C.${inputName(types, operation)}, context: C.CallContext): Promise<Result<C.${stem}Success, ${failureUnion(stem)}>> {`,
    "  context.signal.throwIfAborted();",
    `  const encoded = C.${inputName(types, operation)}.encode(input, "ipc");`,
    '  if (encoded.isErr()) throw new C.ContractDefect("Invalid client input", encoded.error);',
    `  const sent = await options.transport.request(${quote(ipc.command)}, encoded.value, context);`,
    "  if (sent.isErr()) return sent;",
    "  const envelope = readIpcEnvelope(sent.value);",
    `  return classify${stem}(select${stem}Ipc(envelope["tag"]), envelope["body"], "ipc", ipcMismatch);`,
    "}",
  );
}
