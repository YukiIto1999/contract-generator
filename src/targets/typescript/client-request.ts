import type { HttpBinding, HttpParameter } from "../../model/binding-model.js";
import type { ContractType, ObjectType, Operation } from "../../model/contract-model.js";
import { operationStem } from "./operation-names.js";
import { carriesRawBytes, inputOf } from "./operation-plan.js";
import { indent, lines, quote, tsdoc, type SourcePart } from "./source-text.js";

/**
 * Wire member name of a placed parameter
 * @param input - Operation parameter object
 * @param parameter - HTTP placement
 * @returns Wire member name of the input field
 */
function memberOf(input: ObjectType, parameter: HttpParameter): string {
  return input.fields.find((field) => field.name === parameter.parameter)!.wireName;
}

/**
 * Statements placing parameters outside the body
 * @param input - Operation parameter object
 * @param http - HTTP binding
 * @returns Route URL on the service origin followed by query and header placements, each header placement leaving with the communication failure of a value without a wire form
 */
function placementStatements(input: ObjectType, http: HttpBinding): SourcePart {
  const placements = http.parameters
    .filter((parameter) => parameter.location === "path")
    .map(
      (parameter) => `[${quote(`{${parameter.wireName}}`)}, ${quote(memberOf(input, parameter))}]`,
    );
  const rest = http.parameters
    .filter((parameter) => parameter.location !== "path")
    .map((parameter) => {
      const placed = `${quote(parameter.wireName)}, wire, ${quote(memberOf(input, parameter))}`;
      return parameter.location === "query"
        ? `placeQuery(url.searchParams, ${placed});`
        : `if (!placeHeader(headers, ${placed})) return noWireForm();`;
    });
  return [
    `const url = routeUrl(baseUrl, ${quote(http.path)}, wire, [${placements.join(", ")}]);`,
    "if (url === undefined) return noWireForm();",
    "const headers = new Headers();",
    rest,
  ];
}

/**
 * Statements building the request body
 * @param types - Declarations by stable identity
 * @param input - Operation parameter object
 * @param http - HTTP binding
 * @returns Body statements ending with the `body` declaration, absent for a bodyless request
 */
function bodyStatements(
  types: ReadonlyMap<string, ContractType>,
  input: ObjectType,
  http: HttpBinding,
): SourcePart {
  const body = http.body;
  switch (body.kind) {
    case "none":
      return [];
    case "parameters": {
      const placed = http.parameters.map((parameter) => quote(memberOf(input, parameter)));
      return [
        placed.length > 0 && `for (const member of [${placed.join(", ")}]) delete wire[member];`,
        "const body = C.stringifyJson(wire);",
        `headers.set("content-type", ${quote(http.requestMediaType)});`,
      ];
    }
    case "parameter": {
      const field = input.fields.find((candidate) => candidate.name === body.parameter)!;
      const raw = carriesRawBytes(types, field.type, http.requestMediaType);
      const expression = raw
        ? `accepted.value.value[${quote(field.name)}]!.toUint8Array()`
        : `C.stringifyJson(wire[${quote(field.wireName)}])`;
      const present = field.optional
        ? `Object.hasOwn(wire, ${quote(field.wireName)}) ? ${expression} : undefined`
        : expression;
      return [
        `const body: BodyInit | undefined = ${present};`,
        `if (body !== undefined) headers.set("content-type", ${quote(http.requestMediaType)});`,
      ];
    }
  }
}

/**
 * Request construction function of one operation
 * @param types - Declarations by stable identity
 * @param operation - Resolved operation
 * @param http - HTTP binding
 * @returns Function validating the input and building the declared request
 */
export function requestSource(
  types: ReadonlyMap<string, ContractType>,
  operation: Operation,
  http: HttpBinding,
): string {
  const stem = operationStem(operation);
  const input = inputOf(types, operation)!;
  const hasBody = http.body.kind !== "none";
  return lines(
    tsdoc(`Complete ${operation.name} request after client-side validation`, {
      params: [
        ["baseUrl", "Service origin"],
        ["input", "Public client input"],
        ["signal", "Host cancellation carried by the request"],
      ],
      returns:
        "Request with placed parameters, the declared body and the manual redirect mode, or the communication failure of a value without an HTTP wire form",
      throws: ["C.ContractDefect", "Input that violates the contract"],
    }),
    `function build${stem}Request(baseUrl: string, input: C.${input.name}, signal: AbortSignal): Result<Request, C.CommunicationFailure> {`,
    indent(
      lines(
        `const accepted = C.${input.name}.create(input);`,
        'if (accepted.isErr()) throw new C.ContractDefect("Invalid client input", accepted.error.violations);',
        `const encoded = C.${input.name}.toWire(accepted.value.value, "http");`,
        'if (encoded.isErr()) throw new C.ContractDefect("Invalid request input", encoded.error);',
        "const wire = encoded.value as Record<string, unknown>;",
        placementStatements(input, http),
        bodyStatements(types, input, http),
        `return Ok(new Request(url, { method: ${quote(http.method)}, headers, ${hasBody ? "...(body === undefined ? {} : { body }), " : ""}signal, redirect: "manual" }));`,
      ),
    ),
    "}",
  );
}
