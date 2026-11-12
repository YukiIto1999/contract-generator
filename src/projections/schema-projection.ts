import type {
  Binding,
  ContractModel,
  ContractType,
  Field,
  TypeUse,
} from "../model/contract-model.js";
import { constraintSchema } from "./constraint-schema.js";
import {
  constant,
  projectionLimitations,
  referenceToken,
  requiredNode,
  type JsonObject,
  type NodeIndex,
} from "./reference-document.js";
import { isNumericScalar, scalarSchema } from "./scalar-schema.js";

/** Definition location inside the schema document that owns it */
const localDefinitions = "#/$defs/";

/** Use-site reference with nullability and additional restrictions
 * @param use - Resolved type use
 * @param binding - Selected wire interpretation
 * @param types - Complete interpreted node index
 * @param prefix - Reference location within the output document
 * @returns Reference schema for the use site
 */
export function useSchema(
  use: TypeUse,
  binding: Binding,
  types: NodeIndex,
  prefix = localDefinitions,
): JsonObject {
  const node = requiredNode(types, use.id);
  const override = use.encodings?.[binding];
  const encoding = override ?? (node.kind === "scalar" ? node.encodings[binding] : "json");
  const numeric = node.kind === "scalar" && isNumericScalar(node.scalar) && encoding === "json";
  const shape =
    node.kind === "scalar" && override !== undefined
      ? scalarSchema(node, override)
      : { $ref: prefix + referenceToken(use.id) };
  const restricted = { ...shape, ...constraintSchema(use.constraints, numeric) };
  return use.nullable ? { anyOf: [restricted, { type: "null" }] } : restricted;
}

/** Object reference preserving requiredness independently of nullability
 * @param fields - Canonical fields in stable order
 * @param binding - Selected wire interpretation
 * @param types - Complete interpreted node index
 * @param prefix - Referenced definition location
 * @returns Object schema with provider-only default annotations
 */
export function objectSchema(
  fields: readonly Field[],
  binding: Binding,
  types: NodeIndex,
  prefix = localDefinitions,
): JsonObject {
  const properties: JsonObject = {};
  const required: string[] = [];
  for (const field of fields) {
    const property = useSchema(field.type, binding, types, prefix);
    if (field.description !== "") property.description = field.description;
    if (field.default !== undefined) {
      property.default = constant(field.default);
      property["x-contract-default-owner"] = "provider-acceptance";
    }
    properties[field.wireName] = property;
    if (!field.optional) required.push(field.wireName);
  }
  return {
    type: "object",
    properties,
    required,
    additionalProperties: true,
    "x-contract-unknown-properties": "accept-report-path-and-key-drop-value",
  };
}

/** Kind-specific part of a node definition
 * @param node - Interpreted node
 * @param binding - Selected wire interpretation
 * @param types - Complete interpreted node index
 * @returns Reference-only schema keywords for the node kind
 */
function nodeKeywords(node: ContractType, binding: Binding, types: NodeIndex): JsonObject {
  switch (node.kind) {
    case "scalar":
      return scalarSchema(node, node.encodings[binding]);
    case "object":
      return objectSchema(node.fields, binding, types);
    case "array":
      return {
        type: "array",
        items: useSchema(node.element, binding, types),
        ...constraintSchema(node.constraints, false),
      };
    case "literal":
      return { const: constant(node.value) };
    case "enum":
      return { enum: node.members.map((member) => constant(member.value)) };
    case "union":
      return {
        oneOf: node.variants.map((variant) => useSchema(variant.type, binding, types)),
        "x-contract-discriminator": node.discriminator,
      };
  }
}

/** One normalized node projected without reconstructing contract semantics
 * @param node - Interpreted node
 * @param binding - Selected wire interpretation
 * @param types - Complete interpreted node index
 * @returns Reference-only schema definition
 */
function nodeSchema(node: ContractType, binding: Binding, types: NodeIndex): JsonObject {
  return {
    title: node.name,
    ...(node.description === "" ? {} : { description: node.description }),
    ...nodeKeywords(node, binding, types),
  };
}

/** Definition catalogue for one wire interpretation
 * @param model - Complete public contract
 * @param binding - Selected wire interpretation
 * @param types - Complete interpreted node index
 * @returns Reference-only JSON Schema catalogue
 */
export function schemaDocument(
  model: ContractModel,
  binding: Binding,
  types: NodeIndex,
): JsonObject {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: model.namespace,
    $comment: "Reference projection only; not a complete validation schema or a regeneration input",
    "x-contract-generator-purpose": "reference-only",
    "x-contract-binding": binding,
    "x-contract-limitations": projectionLimitations,
    $defs: Object.fromEntries(
      model.types.map((node) => [node.id, nodeSchema(node, binding, types)]),
    ),
  };
}
