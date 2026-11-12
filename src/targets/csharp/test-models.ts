import type {
  ArrayType,
  Constant,
  ContractModel,
  EmissionOptions,
  Field,
  ObjectType,
  Operation,
  Origin,
  ScalarKind,
  ScalarType,
  TypeUse,
  UnionType,
} from "../../model/contract-model.js";

/** Stable declaration coordinates of literal test models */
export const origin: Origin = { file: "test.tsp", start: 0, end: 1, line: 1, column: 1 };

/** Emission options of the target tests */
export const options: EmissionOptions = {
  targets: ["csharp"],
  typescriptEffectModule: undefined,
  csharpNamespace: "Sample",
  rustCratePrefix: "unused",
};

/** Scalar declaration with JSON encodings in both bindings
 * @param id - Stable identity, also used as name
 * @param scalar - Scalar meaning
 * @param role - Effective role identity, or null for an ordinary scalar
 * @returns Resolved scalar
 */
export function scalarOf(id: string, scalar: ScalarKind, role: string | null = null): ScalarType {
  return {
    id,
    name: id,
    kind: "scalar",
    scalar,
    role,
    constraints: {},
    encodings: { http: "json", ipc: "json" },
    preserveLexical: false,
    exported: true,
    description: "",
    origin,
  };
}

/** Use of a node without restrictions
 * @param id - Node identity
 * @param encodings - Use-site encodings
 * @returns Type use
 */
export function use(id: string, encodings?: TypeUse["encodings"]): TypeUse {
  return { id, nullable: false, constraints: {}, origin, ...(encodings ? { encodings } : {}) };
}

/** Object field
 * @param name - Field and wire name
 * @param type - Field type use
 * @param extra - Presence and default
 * @returns Field
 */
export function field(
  name: string,
  type: TypeUse,
  extra: { readonly optional?: boolean; readonly default?: Constant } = {},
): Field {
  return {
    name,
    wireName: name,
    description: "",
    type,
    optional: extra.optional ?? false,
    ...(extra.default ? { default: extra.default } : {}),
    origin,
  };
}

/** Object declaration
 * @param id - Stable identity, also used as name
 * @param fields - Fields in canonical order
 * @returns Resolved object
 */
export function objectOf(id: string, fields: readonly Field[]): ObjectType {
  return { id, name: id, kind: "object", fields, exported: true, description: "", origin };
}

/** Array declaration
 * @param id - Stable identity, also used as name
 * @param element - Element use
 * @returns Resolved array
 */
export function arrayOf(id: string, element: TypeUse): ArrayType {
  return {
    id,
    name: id,
    kind: "array",
    element,
    constraints: {},
    exported: true,
    description: "",
    origin,
  };
}

/** Discriminated union declaration over object variants
 * @param id - Stable identity, also used as name
 * @param variants - Tag and payload object identity pairs
 * @returns Resolved union
 */
export function unionOf(id: string, variants: readonly (readonly [string, string])[]): UnionType {
  return {
    id,
    name: id,
    kind: "union",
    discriminator: "kind",
    variants: variants.map(([tag, payload]) => ({ name: tag, tag, type: use(payload), origin })),
    exported: true,
    description: "",
    origin,
  };
}

/** Operation that only names its input
 * @param name - Operation name
 * @param input - Input object identity
 * @returns Operation without outcomes or bindings
 */
export function operationOf(name: string, input: string): Operation {
  return { id: `Sample.${name}`, name, description: "", input, outcomes: [], origin };
}

/** Contract model over declarations
 * @param types - Declarations
 * @param operations - Operations
 * @returns Model of the Sample namespace
 */
export function modelOf(
  types: ContractModel["types"],
  operations: ContractModel["operations"] = [],
): ContractModel {
  return { namespace: "Sample", name: "Sample", types, operations };
}
