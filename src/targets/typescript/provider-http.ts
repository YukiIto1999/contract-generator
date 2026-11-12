import type { HttpBinding } from "../../model/binding-model.js";
import type { ContractType, Operation, Outcome } from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { operationStem } from "./operation-names.js";
import { carriesRawBytes, inputOf } from "./operation-plan.js";
import {
  inputReadingSource,
  placedMembers,
  placementSource,
  routeInputs,
  routePattern,
} from "./provider-request.js";
import { indent, lines, quote, tsdoc, type SourcePart } from "./source-text.js";

/** Declarations by stable identity */
type Types = ReadonlyMap<string, ContractType>;

/**
 * Response statement of one declared outcome
 * @param types - Declarations by stable identity
 * @param operation - Resolved operation
 * @param http - HTTP binding
 * @param outcome - Declared outcome
 * @returns Case returning the declared response
 */
function responseCase(
  types: Types,
  operation: Operation,
  http: HttpBinding,
  outcome: Outcome,
): string {
  const mapping = http.results.find((entry) => entry.outcome === outcome.name)!;
  const headers = {
    ...mapping.headers,
    ...(mapping.mediaType === undefined ? {} : { "content-type": mapping.mediaType }),
  };
  const codec = `C.${operation.name}Outcomes[${quote(outcome.name)}]`;
  const raw = carriesRawBytes(types, outcome.type, mapping.mediaType);
  const body =
    outcome.type === undefined
      ? "null"
      : raw
        ? `rawPayload(${codec}, outcome.value)`
        : `C.stringifyJson(wirePayload(${codec}, outcome.value, "http"))`;
  return `case ${quote(outcome.name)}: return new Response(${body}, { status: ${mapping.status}, headers: ${quote(headers)} });`;
}

/**
 * Exhaustive response mapping of a handler result
 * @param types - Declarations by stable identity
 * @param operation - Resolved operation
 * @param http - HTTP binding
 * @returns Function mapping success and rejection cases to declared responses
 */
function responseSource(types: Types, operation: Operation, http: HttpBinding): string {
  const stem = operationStem(operation);
  const branch = (rejection: boolean): SourcePart => {
    const cases = operation.outcomes
      .filter((outcome) => outcome.rejection === rejection)
      .map((outcome) => responseCase(types, operation, http, outcome));
    const guard = rejection ? "result.isErr()" : "result.isOk()";
    const outcome = rejection ? "result.error" : "result.value";
    if (cases.length === 0) return [];
    return [
      `if (${guard}) {`,
      `  const outcome = ${outcome};`,
      "  switch (outcome.case) {",
      indent(lines(cases), 2),
      "  }",
      "}",
    ];
  };
  return lines(
    tsdoc(`Declared HTTP response of a ${operation.name} handler result`, {
      params: [["result", "Handler success or declared rejection"]],
      returns: "Response with the declared status, media type and selector headers",
      throws: ["C.ContractDefect", "Result outside the declared cases or with an invalid payload"],
    }),
    `function respond${stem}Http(result: Result<C.${stem}Success, C.${stem}Rejection>): Response {`,
    indent(
      lines(branch(false), branch(true), 'throw new C.ContractDefect("Unknown handler outcome");'),
    ),
    "}",
  );
}

/**
 * Statement dropping body members that repeat a placed parameter
 * @param types - Declarations by stable identity
 * @param operation - Resolved operation
 * @param http - HTTP binding
 * @returns Declaration of the dropped-member diagnostics
 */
function dropSource(types: Types, operation: Operation, http: HttpBinding): string {
  const members = placedMembers(inputOf(types, operation)!, http);
  return http.body.kind === "parameters" && members.length > 0
    ? `const dropped = dropPlacedMembers(parameters, [${members.map((member) => quote(member)).join(", ")}]);`
    : "const dropped: readonly C.Diagnostic[] = [];";
}

/**
 * Handling function of one operation request
 * @param types - Declarations by stable identity
 * @param operation - Resolved operation
 * @param http - HTTP binding
 * @returns Function reading, placing, accepting, dispatching and responding
 */
function handlerSource(types: Types, operation: Operation, http: HttpBinding): string {
  const stem = operationStem(operation);
  const needs = routeInputs(http);
  const extra = needs.filter(([, name]) => name !== "request");
  const drop = dropSource(types, operation, http);
  const place =
    http.parameters.length === 0
      ? []
      : [
          `const violations = place${stem}Parameters(${["parameters", ...needs.map(([, name]) => name)].join(", ")});`,
          "if (violations !== undefined) return invalidInput(violations);",
        ];
  const parameters = [
    "parts: ProviderParts<Env>",
    "request: Request",
    ...extra.map(([declaration]) => declaration),
    "env: Env",
    "context: C.CallContext",
  ];
  return lines(
    tsdoc(`Complete ${operation.name} HTTP handling through provider acceptance`, {
      params: [
        ["parts", "Provider collaborators"],
        ["request", "Host request"],
        ...extra.map(([, name, meaning]) => [name, meaning] as const),
        ["env", "Handwritten adapter capabilities"],
        ["context", "Host cancellation and deadline"],
      ],
      returns: "Declared response with input diagnostics or the typed inbound failure",
      throws: ["C.ContractDefect", "Handler result outside the contract"],
    }),
    `async function handle${stem}Http<Env>(${parameters.join(", ")}): Promise<Result<C.Accepted<Response>, HttpFailure>> {`,
    indent(
      lines(
        `const read = await read${stem}Input(parts, request, context);`,
        "if (read.isErr()) return read;",
        "const parameters = read.value;",
        drop,
        place,
        `const accepted = C.accept${stem}(parameters, "http");`,
        "if (accepted.isErr()) return invalidInput(accepted.error);",
        "context.signal.throwIfAborted();",
        `const result = await parts.handlers.${operation.name}(accepted.value.value)(env, context.signal, context.deadlineAt);`,
        `return Ok(Object.freeze({ value: respond${stem}Http(result), diagnostics: [...accepted.value.diagnostics, ...dropped] }));`,
      ),
    ),
    "}",
  );
}

/**
 * Complete HTTP handling of one operation
 * @param types - Declarations by stable identity
 * @param operation - Resolved operation
 * @param http - HTTP binding
 * @returns Route constant, body reading, placement, response mapping and handling functions
 */
export function httpOperationSource(types: Types, operation: Operation, http: HttpBinding): string {
  const input = inputOf(types, operation)!;
  return lines(
    tsdoc(`Route of the ${operation.name} operation`),
    `const ${operation.name}Route = new RegExp(${quote(routePattern(http.path).source)});`,
    "",
    inputReadingSource(types, input, operation, http),
    "",
    placementSource(types, input, operation, http),
    responseSource(types, operation, http),
    "",
    handlerSource(types, operation, http),
  );
}

/**
 * Route dispatch statements of the HTTP operations
 * @param operations - Operations published over HTTP in stable order
 * @returns One guarded delegation per operation
 */
export function httpDispatchStatements(operations: readonly Operation[]): readonly string[] {
  return [...operations]
    .sort((a, b) => compareText(a.id, b.id))
    .flatMap((operation) => {
      const http = operation.http!;
      const names = routeInputs(http).map(([, name]) => name);
      const forwarded = [
        "parts",
        "request",
        ...names.filter((name) => name !== "request"),
        "env",
        "context",
      ].map((name) => (name === "match" ? `${operation.name}Match` : name));
      return [
        `const ${operation.name}Match = ${operation.name}Route.exec(url.pathname);`,
        `if (request.method === ${quote(http.method)} && ${operation.name}Match !== null) return handle${operationStem(operation)}Http(${forwarded.join(", ")});`,
      ];
    });
}
