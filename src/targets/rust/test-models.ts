import type {
  ContractModel,
  ContractType,
  Field,
  Operation,
  Origin,
  TypeUse,
} from "../../model/contract-model.js";

/** Declaration position shared by every hand-built declaration */
export const origin: Origin = { file: "contract.tsp", start: 0, end: 1, line: 1, column: 1 };

/** Use of a declaration without restrictions
 * @param id - Declaration identity
 * @param nullable - Explicit null allowance
 * @returns Type use
 */
export function use(id: string, nullable = false): TypeUse {
  return { id, nullable, constraints: {}, origin };
}

/** Object field
 * @param name - Field name
 * @param type - Resolved use
 * @param optional - Permission to omit the field
 * @returns Field declaration
 */
export function member(name: string, type: TypeUse, optional = false): Field {
  return { name, wireName: name, description: "", type, optional, origin };
}

/** Declaration identity fields shared by every hand-built declaration
 * @param name - Declaration name
 * @returns Common declaration members
 */
function declaration(name: string): {
  id: string;
  name: string;
  description: string;
  origin: Origin;
  exported: boolean;
} {
  return { id: `Test.${name}`, name, description: "", origin, exported: true };
}

/** Ordinary string scalar
 * @param name - Declaration name
 * @param encoding - Binding-local encoding of the scalar
 * @returns Scalar declaration
 */
export function text(name: string, encoding: "json" | "unixTimestamp" = "json"): ContractType {
  return {
    ...declaration(name),
    kind: "scalar",
    scalar: "string",
    role: null,
    constraints: {},
    encodings: { http: encoding, ipc: encoding },
    preserveLexical: false,
  };
}

/** Ordinary 32-bit integer scalar
 * @param name - Declaration name
 * @returns Scalar declaration
 */
export function integer(name: string): ContractType {
  return { ...(text(name) as Extract<ContractType, { kind: "scalar" }>), scalar: "int32" };
}

/** Object declaration
 * @param name - Declaration name
 * @param fields - Fields in canonical order
 * @returns Object declaration
 */
export function object(name: string, fields: readonly Field[]): ContractType {
  return { ...declaration(name), kind: "object", fields };
}

/** Union declaration discriminated by `kind`
 * @param name - Declaration name
 * @param variants - Case names with their payload object names
 * @returns Union declaration
 */
export function union(
  name: string,
  variants: readonly (readonly [string, string])[],
): ContractType {
  return {
    ...declaration(name),
    kind: "union",
    discriminator: "kind",
    variants: variants.map(([tag, payload]) => ({
      name: tag,
      tag,
      type: use(`Test.${payload}`),
      origin,
    })),
  };
}

/** Literal declaration of one string
 * @param name - Declaration name
 * @param value - Exact string
 * @returns Literal declaration
 */
export function literal(name: string, value: string): ContractType {
  return { ...declaration(name), kind: "literal", value: { kind: "string", value } };
}

/** Operation published over HTTP and IPC with an object input and one payload result
 * @param name - Operation name
 * @param payload - Result payload declaration name
 * @param method - HTTP method
 * @returns Operation declaration; its input object is `<Name>Input`
 */
export function operation(name: string, payload: string, method = "POST"): Operation {
  const stem = `${name[0]?.toUpperCase()}${name.slice(1)}`;
  return {
    id: `Test.${name}`,
    name,
    description: "",
    input: `Test.${stem}Input`,
    outcomes: [
      { name: "done", rejection: false, type: use(`Test.${payload}`), description: "", origin },
    ],
    http: {
      method,
      path: `/${name}`,
      body: { kind: "parameters" },
      requestMediaType: "application/json",
      parameters: [],
      results: [
        { outcome: "done", status: 200, mediaType: "application/json", headers: {}, origin },
      ],
      origin,
    },
    ipc: { command: name, results: [{ outcome: "done", tag: "done", origin }], origin },
    origin,
  };
}

/** Contract whose operations take one declaration and return another
 * @param types - Declarations besides the generated operation inputs
 * @param operations - Operations over those declarations
 * @param inputs - Names of the declarations each operation takes
 * @returns Model with the generated input objects added
 */
export function contract(
  types: readonly ContractType[],
  operations: readonly Operation[],
  inputs: readonly string[],
): ContractModel {
  const generated = operations.map((entry, index) =>
    object(`${entry.input.slice("Test.".length)}`, [
      member("value", use(`Test.${inputs[index] ?? ""}`)),
    ]),
  );
  return { namespace: "Test", name: "Test", types: [...types, ...generated], operations };
}
