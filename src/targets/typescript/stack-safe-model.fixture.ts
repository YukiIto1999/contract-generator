import type {
  ArrayType,
  ContractModel,
  LiteralType,
  TypeUse,
  UnionType,
} from "../../model/contract-model.js";
import {
  httpOperation,
  member,
  objectType,
  origin,
  outcome,
  scalarType,
  use,
} from "./model-builders.js";

/**
 * Recursive reference without cyclic generator metadata
 * @param name - Declaration name
 * @returns Unrestricted non-nullable reference
 */
function reference(name: string): TypeUse {
  return { id: `T.${name}`, nullable: false, constraints: {}, origin };
}

/** Text scalar carrying omission-only provider defaults */
const text = scalarType("Text", "string");
/** Independently calculated handler result */
const count = scalarType("Count", "int32");
/** Recursive object with a default at every depth */
const node = objectType("Node", [
  { ...member("label", text, true), default: { kind: "string", value: "default" } },
  {
    name: "next",
    wireName: "next",
    description: "",
    type: reference("Node"),
    optional: true,
    origin,
  },
]);
/** Recursive array terminating at an empty array */
const nest: ArrayType = {
  ...objectType("Nest", []),
  kind: "array",
  element: reference("Nest"),
  constraints: {},
};
/** Exact union discriminator */
const tag: LiteralType = {
  ...objectType("Tag", []),
  kind: "literal",
  value: { kind: "string", value: "link" },
};
/** Recursive union payload */
const link = objectType("Link", [
  member("kind", tag),
  {
    name: "next",
    wireName: "next",
    description: "",
    type: reference("Choice"),
    optional: true,
    origin,
  },
]);
/** Recursive discriminated union */
const choice: UnionType = {
  ...objectType("Choice", []),
  kind: "union",
  discriminator: "kind",
  variants: [{ name: "Link", tag: "link", type: use(link), origin }],
};
/** Operation input exercising each recursive shape */
const payload = objectType("Payload", [
  member("node", node),
  member("nest", nest),
  member("choice", choice),
]);
/** Independent occurrences of a shared child */
const pair = objectType("Pair", [member("left", node), member("right", node)]);
/** Use-site cardinality stricter than declaration provenance */
const narrow = objectType("Narrow", [
  { ...member("items", nest), type: { ...use(nest), constraints: { maxItems: 0 } } },
]);

/** Independent recursive declarations with provider-only defaults */
export const recursiveModel: ContractModel = {
  namespace: "T",
  name: "T",
  types: [text, count, node, nest, tag, link, choice, payload, pair, narrow],
  operations: [
    httpOperation("measure", payload, [outcome("Measured", count)], {
      method: "POST",
      path: "/measure",
      body: { kind: "parameters" },
      requestMediaType: "application/json",
      parameters: [],
      results: [
        { outcome: "Measured", status: 200, headers: {}, mediaType: "application/json", origin },
      ],
    }),
  ],
};
