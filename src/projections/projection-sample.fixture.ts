import type { HttpBinding, HttpResult } from "../model/binding-model.js";
import type {
  Binding,
  Constant,
  Constraints,
  ContractModel,
  ContractType,
  Encoding,
  Field,
  Operation,
  Origin,
  Outcome,
  ScalarKind,
  TypeUse,
} from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";

/** Declaration coordinates shared by every sample node */
const origin: Origin = { file: "sample.tsp", start: 0, end: 0, line: 1, column: 1 };

/** Identity of the intrinsic bytes scalar */
export const bytesId = "TypeSpec.bytes";
/** Identity of the intrinsic string scalar */
export const stringId = "TypeSpec.string";
/** Identity of an unsigned 64-bit scalar bounded beyond 2^53 */
export const wideIntegerId = "Sample.WideInteger";
/** Identity of a string-encoded decimal bounded beyond 2^53 */
export const exactDecimalId = "Sample.ExactDecimal";
/** Identity of a small integer scalar */
export const countId = "Sample.Count";
/** Identity of an object holding a nested provider default */
export const childId = "Sample.Child";
/** Identity of the object that is the input of the `submit` operation */
export const submitInputId = "Sample.submit.Input";
/** Declared lower bound of the wide integer, 2^53 + 1 */
export const wideMinimum = "9007199254740993";
/** Declared exclusive upper bound of the wide integer, 2^64 - 1 */
export const wideMaximum = "18446744073709551615";
/** Declared exclusive lower bound of the exact decimal */
export const decimalMinimum = "-12345678901234567890.12345678901234567890";

/** Portable declaration name of a node identity
 * @param id - Node identity below its namespace
 * @returns Identity segments joined without separators
 */
function nameOf(id: string): string {
  return id.slice(id.indexOf(".") + 1).replaceAll(".", "");
}

/** Type use without use-site restrictions
 * @param id - Referenced node identity
 * @returns Non-nullable use of the node
 */
function use(id: string): TypeUse {
  return { id, nullable: false, constraints: {}, origin };
}

/** Object field of the sample contract
 * @param name - Canonical and wire name
 * @param typeId - Referenced node identity
 * @param provided - Presence and provider default of the field
 * @returns Field declaration
 */
function field(
  name: string,
  typeId: string,
  provided: { readonly optional?: boolean; readonly default?: Constant } = {},
): Field {
  return {
    name,
    wireName: name,
    description: "",
    type: use(typeId),
    optional: provided.optional ?? false,
    ...(provided.default === undefined ? {} : { default: provided.default }),
    origin,
  };
}

/** Scalar node of the sample contract
 * @param id - Node identity and name
 * @param scalar - Resolved scalar meaning
 * @param encoding - Representation used by both bindings
 * @param constraints - Declared restrictions
 * @returns Scalar declaration
 */
function scalarNode(
  id: string,
  scalar: ScalarKind,
  encoding: Encoding,
  constraints: Constraints = {},
): ContractType {
  const encodings: Record<Binding, Encoding> = { http: encoding, ipc: encoding };
  return {
    kind: "scalar",
    id,
    name: nameOf(id),
    description: "",
    origin,
    exported: false,
    scalar,
    role: null,
    constraints,
    encodings,
    preserveLexical: false,
  };
}

/** Object node of the sample contract
 * @param id - Node identity and name
 * @param fields - Canonical fields in declaration order
 * @returns Object declaration
 */
function objectNode(id: string, fields: readonly Field[]): ContractType {
  return {
    kind: "object",
    id,
    name: nameOf(id),
    description: "",
    origin,
    exported: true,
    fields,
  };
}

/** Declared outcome with an optional payload
 * @param name - Canonical outcome name
 * @param payloadId - Payload node identity or undefined for a void result
 * @returns Successful outcome
 */
function outcome(name: string, payloadId: string | undefined): Outcome {
  return {
    name,
    rejection: false,
    ...(payloadId === undefined ? {} : { type: use(payloadId) }),
    description: "",
    origin,
  };
}

/** Response mapping of the sample contract
 * @param name - Canonical outcome name
 * @param status - Exact HTTP status
 * @param mediaType - Declared media type or undefined for a bodyless result
 * @returns Response mapping without header selectors
 */
function result(name: string, status: number, mediaType: string | undefined): HttpResult {
  return {
    outcome: name,
    status,
    ...(mediaType === undefined ? {} : { mediaType }),
    headers: {},
    origin,
  };
}

/** HTTP-published operation of the sample contract
 * @param name - Operation name
 * @param inputId - Input object identity
 * @param http - HTTP interpretation without origin
 * @param outcomes - Declared outcomes
 * @returns Public operation
 */
function operation(
  name: string,
  inputId: string,
  http: Omit<HttpBinding, "origin">,
  outcomes: readonly Outcome[],
): Operation {
  return {
    id: "Sample." + name,
    name,
    description: "",
    input: inputId,
    outcomes,
    http: { ...http, origin },
    origin,
  };
}

/** Nodes of the sample contract
 * @returns Intrinsic scalars, bounded scalars and the objects that use them
 */
function sampleNodes(): ContractType[] {
  const bound = (value: string, exclusive: boolean): { value: string; exclusive: boolean } => ({
    value,
    exclusive,
  });
  return [
    scalarNode(bytesId, "bytes", "base64"),
    scalarNode(stringId, "string", "json"),
    scalarNode(wideIntegerId, "uint64", "json", {
      minimum: bound(wideMinimum, false),
      maximum: bound(wideMaximum, true),
    }),
    scalarNode(exactDecimalId, "decimal", "string", { minimum: bound(decimalMinimum, true) }),
    scalarNode(countId, "int32", "json", {
      minimum: bound("1", false),
      maximum: bound("3", false),
    }),
    objectNode(childId, [
      field("retries", countId, { optional: true, default: { kind: "number", text: "3" } }),
    ]),
    objectNode(submitInputId, [
      field("amount", wideIntegerId),
      field("exact", exactDecimalId),
      field("limit", countId, { optional: true, default: { kind: "number", text: "3" } }),
      field("child", childId, { optional: true }),
      field("note", stringId, { optional: true }),
    ]),
    objectNode("Sample.Receipt", [field("value", stringId)]),
    objectNode("Sample.upload.Input", [field("payload", bytesId)]),
    objectNode("Sample.fetch.Input", []),
  ];
}

/** Operations whose request and response bodies cover every bytes media type rule
 * @returns Operations over HTTP only
 */
function sampleOperations(): Operation[] {
  const base = { method: "POST", parameters: [], requestMediaType: "application/json" };
  return [
    operation(
      "submit",
      submitInputId,
      {
        ...base,
        path: "/submit",
        body: { kind: "parameters" },
        results: [result("Done", 200, "application/json")],
      },
      [outcome("Done", "Sample.Receipt")],
    ),
    operation(
      "upload",
      "Sample.upload.Input",
      {
        ...base,
        path: "/upload",
        body: { kind: "parameter", parameter: "payload" },
        requestMediaType: "application/octet-stream",
        results: [result("Stored", 204, undefined)],
      },
      [outcome("Stored", undefined)],
    ),
    operation(
      "fetch",
      "Sample.fetch.Input",
      {
        ...base,
        method: "GET",
        path: "/fetch",
        body: { kind: "none" },
        results: [
          result("Raw", 200, "application/octet-stream"),
          result("Described", 201, "application/vnd.sample+json"),
        ],
      },
      [outcome("Raw", bytesId), outcome("Described", bytesId)],
    ),
  ];
}

/** Hand-built contract exercising exact bounds, provider defaults and bytes bodies
 * @returns Complete contract model whose expected projections follow from its declarations
 */
export function projectionSample(): ContractModel {
  return {
    namespace: "Sample",
    name: "Sample",
    types: sampleNodes().sort((left, right) => compareText(left.id, right.id)),
    operations: sampleOperations().sort((left, right) => compareText(left.id, right.id)),
  };
}
