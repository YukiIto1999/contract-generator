import type { HttpBinding, HttpParameter, HttpResult } from "../../model/binding-model.js";
import type {
  ContractModel,
  ContractType,
  Field,
  ObjectType,
  Operation,
  Origin,
  Outcome,
  ScalarKind,
  ScalarType,
  TypeUse,
} from "../../model/contract-model.js";

/** Declaration position shared by every hand-built declaration */
export const origin: Origin = { file: "model.tsp", start: 0, end: 1, line: 1, column: 1 };

/**
 * Plain reference to a declaration
 * @param type - Referenced declaration
 * @returns Non-nullable reference without use-site restrictions
 */
export function use(type: ContractType): TypeUse {
  return { id: type.id, nullable: false, constraints: {}, origin };
}

/**
 * Scalar declaration with JSON encodings
 * @param name - Declaration name
 * @param scalar - Scalar meaning
 * @param extra - Overrides of the default scalar properties
 * @returns Scalar declaration
 */
export function scalarType(
  name: string,
  scalar: ScalarKind,
  extra: Partial<ScalarType> = {},
): ScalarType {
  return {
    kind: "scalar",
    id: `T.${name}`,
    name,
    description: "",
    origin,
    exported: true,
    scalar,
    role: null,
    constraints: {},
    encodings: { http: "json", ipc: "json" },
    preserveLexical: false,
    ...extra,
  };
}

/**
 * Object member
 * @param name - Member name used on the wire as well
 * @param type - Member declaration
 * @param optional - Permission to omit the member
 * @returns Member
 */
export function member(name: string, type: ContractType, optional = false): Field {
  return { name, wireName: name, description: "", type: use(type), optional, origin };
}

/**
 * Object declaration
 * @param name - Declaration name
 * @param fields - Members in canonical order
 * @returns Object declaration
 */
export function objectType(name: string, fields: readonly Field[]): ObjectType {
  return { kind: "object", id: `T.${name}`, name, description: "", origin, exported: true, fields };
}

/**
 * Declared outcome
 * @param name - Case name
 * @param type - Payload declaration, absent for a void outcome
 * @param rejection - Whether the outcome is an expected rejection
 * @returns Outcome
 */
export function outcome(name: string, type?: ContractType, rejection = false): Outcome {
  return {
    name,
    rejection,
    description: "",
    origin,
    ...(type === undefined ? {} : { type: use(type) }),
  };
}

/**
 * HTTP-published operation
 * @param name - Operation name
 * @param input - Parameter object declaration
 * @param outcomes - Declared outcomes
 * @param http - HTTP interpretation
 * @returns Operation
 */
export function httpOperation(
  name: string,
  input: ObjectType,
  outcomes: readonly Outcome[],
  http: Omit<HttpBinding, "origin">,
): Operation {
  return {
    id: `T.${name}`,
    name,
    description: "",
    input: input.id,
    outcomes,
    http: { ...http, origin },
    origin,
  };
}

/**
 * Declared placement of one sample parameter
 * @param name - Canonical input field
 * @param location - Request location
 * @param wireName - Name on the wire
 * @returns Parameter mapping
 */
function sampleParameter(
  name: string,
  location: "path" | "header",
  wireName: string,
): HttpParameter {
  return { parameter: name, location, wireName, origin };
}

/**
 * Status 200 mapping of one sample outcome
 * @param outcomeName - Canonical outcome
 * @param mediaType - Body media type absent for a bodyless result
 * @returns Result mapping
 */
function sampleResult(outcomeName: string, mediaType?: string): HttpResult {
  return {
    outcome: outcomeName,
    status: 200,
    headers: {},
    origin,
    ...(mediaType === undefined ? {} : { mediaType }),
  };
}

/**
 * Bodyless GET sample operation at a route named after it
 * @param name - Operation name
 * @param input - Empty input object
 * @param outcomes - Canonical results
 * @param results - Result mappings
 * @returns Operation published over HTTP
 */
function sampleGet(
  name: string,
  input: ObjectType,
  outcomes: readonly Outcome[],
  results: readonly HttpResult[],
): Operation {
  return httpOperation(name, input, outcomes, {
    method: "GET",
    path: `/${name}`,
    body: { kind: "none" },
    requestMediaType: "application/json",
    parameters: [],
    results,
  });
}

/**
 * Contract of four HTTP operations covering placed parameters, a bodyless result and bytes in JSON and raw media
 * @returns Model with `place`, `ping`, `blobJson` and `blobRaw`
 */
export function httpSampleModel(): ContractModel {
  const text = scalarType("Text", "string");
  const blob = scalarType("Blob", "bytes", { encodings: { http: "base64", ipc: "base64" } });
  const placeInput = objectType("PlaceInput", [
    member("id", text),
    member("token", text),
    member("note", text),
  ]);
  const reply = objectType("Reply", [member("value", text)]);
  const empty = objectType("Empty", []);
  const parameter = sampleParameter;
  const result = sampleResult;
  const get = (
    name: string,
    outcomes: readonly Outcome[],
    results: readonly HttpResult[],
  ): Operation => sampleGet(name, empty, outcomes, results);
  return {
    namespace: "T",
    name: "T",
    types: [text, blob, placeInput, reply, empty],
    operations: [
      httpOperation("place", placeInput, [outcome("Placed", reply)], {
        method: "POST",
        path: "/things/{id}",
        body: { kind: "parameters" },
        requestMediaType: "application/json",
        parameters: [parameter("id", "path", "id"), parameter("token", "header", "x-token")],
        results: [result("Placed", "application/json")],
      }),
      get("ping", [outcome("Done")], [result("Done")]),
      get("blobJson", [outcome("Loaded", blob)], [result("Loaded", "application/json")]),
      get("blobRaw", [outcome("Loaded", blob)], [result("Loaded", "application/octet-stream")]),
    ],
  };
}
