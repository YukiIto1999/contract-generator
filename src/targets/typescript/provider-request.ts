import type { HttpBinding } from "../../model/binding-model.js";
import type { ContractType, Field, ObjectType, Operation } from "../../model/contract-model.js";
import { operationStem } from "./operation-names.js";
import { carriesRawBytes, mediaEssence } from "./operation-plan.js";
import { indent, lines, quote, tsdoc, type SourcePart } from "./source-text.js";

/** Declarations by stable identity */
type Types = ReadonlyMap<string, ContractType>;

/** Request-derived input of a route function: declaration, name and meaning */
export type RouteInput = readonly [declaration: string, name: string, meaning: string];

/**
 * Route pattern of a path template
 * @param path - Absolute route template
 * @returns Anchored regular expression source and the placeholder names in capture order
 */
export function routePattern(path: string): {
  readonly source: string;
  readonly placeholders: readonly string[];
} {
  const parts = path.split("/");
  const placeholder = (part: string): boolean => part.startsWith("{") && part.endsWith("}");
  const source = parts
    .map((part) => (placeholder(part) ? "([^/]+)" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return {
    source: `^${source}$`,
    placeholders: parts.filter(placeholder).map((part) => part.slice(1, -1)),
  };
}

/**
 * Request parts the placement of non-body parameters reads
 * @param http - HTTP binding
 * @returns Headers, URL and route match inputs in declaration order, only the ones a placement uses
 */
export function routeInputs(http: HttpBinding): readonly RouteInput[] {
  const uses = (location: string): boolean =>
    http.parameters.some((parameter) => parameter.location === location);
  return [
    ...(uses("header") ? [["request: Request", "request", "Host request"] as const] : []),
    ...(uses("query") ? [["url: URL", "url", "Request URL"] as const] : []),
    ...(uses("path")
      ? [["match: RegExpExecArray", "match", "Route match with the path captures"] as const]
      : []),
  ];
}

/**
 * Input field of a parameter name
 * @param input - Operation parameter object
 * @param name - Canonical field name
 * @returns The field
 */
function fieldOf(input: ObjectType, name: string): Field {
  return input.fields.find((field) => field.name === name)!;
}

/**
 * Wire member names of the parameters placed outside the body
 * @param input - Operation parameter object
 * @param http - HTTP binding
 * @returns Wire member names in placement order
 */
export function placedMembers(input: ObjectType, http: HttpBinding): readonly string[] {
  return http.parameters.map((parameter) => fieldOf(input, parameter.parameter).wireName);
}

/**
 * Whether a placed value travels as text rather than as a JSON token
 * @param types - Declarations by stable identity
 * @param field - Input field of the parameter
 * @returns Whether the wire value is the text itself
 */
function isTextual(types: Types, field: Field): boolean {
  const type = types.get(field.type.id)!;
  switch (type.kind) {
    case "scalar": {
      const encoding = field.type.encodings?.http ?? type.encodings.http;
      if (encoding === "unixTimestamp") return false;
      return (
        encoding === "string" ||
        [
          "string",
          "bytes",
          "offsetDateTime",
          "utcDateTime",
          "plainDate",
          "plainTime",
          "duration",
        ].includes(type.scalar)
      );
    }
    case "literal":
      return type.value.kind === "string";
    case "enum":
      return type.members.every((member) => member.value.kind === "string");
    case "object":
    case "array":
    case "union":
      return false;
  }
}

/**
 * Body reading statements of one operation
 * @param types - Declarations by stable identity
 * @param input - Operation parameter object
 * @param http - HTTP binding
 * @returns Statements producing the wire parameter object or returning an inbound failure
 */
function bodyReading(types: Types, input: ObjectType, http: HttpBinding): SourcePart {
  const body = http.body;
  const media = quote(mediaEssence(http.requestMediaType));
  switch (body.kind) {
    case "none":
      return [
        "const received = await parts.readBody(request, context);",
        "if (received.isErr()) return received;",
        'if (received.value.length !== 0) return invalidInput([{ path: "", rule: "type" }]);',
        "return Ok(Object.create(null) as Record<string, unknown>);",
      ];
    case "parameters":
      return [
        `const bytes = await requestBytes(parts, request, context, ${media});`,
        "if (bytes.isErr()) return bytes;",
        "const members = C.parseJsonBytes(bytes.value).andThen(C.jsonObject);",
        "if (members.isErr()) return invalidInput(members.error);",
        "return Ok(Object.assign(Object.create(null) as Record<string, unknown>, members.value));",
      ];
    case "parameter": {
      const field = fieldOf(input, body.parameter);
      const member = quote(field.wireName);
      const decode = carriesRawBytes(types, field.type, http.requestMediaType)
        ? [`parameters[${member}] = bytes.value;`]
        : [
            "const parsed = C.parseJsonBytes(bytes.value);",
            "if (parsed.isErr()) return invalidInput(parsed.error);",
            `parameters[${member}] = parsed.value;`,
          ];
      return [
        "const parameters = Object.create(null) as Record<string, unknown>;",
        'if (request.body === null && !request.headers.has("content-type")) return Ok(parameters);',
        `const bytes = await requestBytes(parts, request, context, ${media});`,
        "if (bytes.isErr()) return bytes;",
        decode,
        "return Ok(parameters);",
      ];
    }
  }
}

/**
 * Body reading function of one operation
 * @param types - Declarations by stable identity
 * @param input - Operation parameter object
 * @param operation - Resolved operation
 * @param http - HTTP binding
 * @returns Function producing the wire parameter object of the request body
 */
export function inputReadingSource(
  types: Types,
  input: ObjectType,
  operation: Operation,
  http: HttpBinding,
): string {
  return lines(
    tsdoc(`Wire parameters of a ${operation.name} request body`, {
      params: [
        ["parts", "Provider collaborators"],
        ["request", "Host request"],
        ["context", "Host cancellation and deadline"],
      ],
      returns: "Wire parameter object or the typed inbound failure",
    }),
    `async function read${operationStem(operation)}Input<Env>(parts: ProviderParts<Env>, request: Request, context: C.CallContext): Promise<Result<Record<string, unknown>, InvalidInput | C.CommunicationFailure>> {`,
    indent(lines(bodyReading(types, input, http))),
    "}",
  );
}

/**
 * Placement function of the parameters outside the body
 * @param types - Declarations by stable identity
 * @param input - Operation parameter object
 * @param operation - Resolved operation
 * @param http - HTTP binding
 * @returns Function placing path, query and header values, absent when none is placed
 */
export function placementSource(
  types: Types,
  input: ObjectType,
  operation: Operation,
  http: HttpBinding,
): SourcePart {
  if (http.parameters.length === 0) return [];
  const { placeholders } = routePattern(http.path);
  const calls = http.parameters.map((parameter) => {
    const field = fieldOf(input, parameter.parameter);
    const member = quote(field.wireName);
    const text = isTextual(types, field);
    switch (parameter.location) {
      case "path":
        return `placeParameter(parameters, ${member}, match[${placeholders.indexOf(parameter.wireName) + 1}], { text: ${text}, encoded: true })`;
      case "query":
        return `placeParameter(parameters, ${member}, url.searchParams.get(${quote(parameter.wireName)}), { text: ${text}, encoded: false })`;
      case "header":
        return `placeParameter(parameters, ${member}, request.headers.get(${quote(parameter.wireName)}), { text: ${text}, encoded: false })`;
    }
  });
  const needs = routeInputs(http);
  const declarations = [
    "parameters: Record<string, unknown>",
    ...needs.map(([declaration]) => declaration),
  ];
  return [
    tsdoc(`Placement of the ${operation.name} parameters carried outside the body`, {
      params: [
        ["parameters", "Wire parameter object under construction"],
        ...needs.map(([, name, meaning]) => [name, meaning] as const),
      ],
      returns: "Violations of a malformed value, absent when every present value is placed",
    }),
    `function place${operationStem(operation)}Parameters(${declarations.join(", ")}): readonly C.Violation[] | undefined {`,
    `  return ${calls.join("\n    ?? ")};`,
    "}",
    "",
  ];
}
