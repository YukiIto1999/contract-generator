import type {
  ArrayType,
  Constant,
  ObjectType,
  ScalarType,
  TypeUse,
  UnionType,
} from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import type { CSharpContext } from "./context.js";

/** Scalar meanings whose JSON number may travel as a string under the string encoding */
const numericScalars: Readonly<Record<string, true>> = {
  int32: true,
  int64: true,
  uint64: true,
  integer: true,
  decimal: true,
  float32: true,
  float64: true,
};

/** Exact JSON constant rendering
 * @param value - Normalized constant
 * @returns JSON without binary64 conversion
 */
export function constant(value: Constant): string {
  switch (value.kind) {
    case "array":
      return `[${value.items.map(constant).join(",")}]`;
    case "object":
      return `{${sortedKeys(value.properties)
        .map((key) => `${JSON.stringify(key)}:${constant(value.properties[key]!)}`)
        .join(",")}}`;
    case "number":
      return value.text;
    case "null":
      return "null";
    case "boolean":
    case "string":
      return JSON.stringify(value.value);
  }
}

/** Deterministic property enumeration of a constant object
 * @param properties - Constant object members
 * @returns Names in code-unit order
 */
function sortedKeys(properties: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(properties).sort(compareText);
}

/** Constant bytes in the binding's textual alphabet
 * @param items - Constant byte values
 * @param encoding - Effective HTTP encoding
 * @returns JSON string literal holding base64 or unpadded base64url
 */
function bytesConstant(items: readonly Constant[], encoding: string): string {
  const bytes = Buffer.from(items.map((item) => (item.kind === "number" ? Number(item.text) : 0)));
  return JSON.stringify(bytes.toString(encoding === "base64url" ? "base64url" : "base64"));
}

/** Scalar constant in the representation of the effective HTTP encoding
 * @param scalar - Resolved scalar declaration
 * @param encoding - Effective HTTP encoding of the use site
 * @param value - Exact constant
 * @returns JSON token that the generated reader accepts for this scalar
 */
function scalarConstant(scalar: ScalarType, encoding: string, value: Constant): string {
  if (scalar.scalar === "bytes" && value.kind === "array")
    return bytesConstant(value.items, encoding);
  if (encoding !== "string") return constant(value);
  if (value.kind === "boolean") return JSON.stringify(String(value.value));
  if (value.kind === "number" && numericScalars[scalar.scalar] === true)
    return JSON.stringify(value.text);
  return constant(value);
}

/** Array constant with every element in its own representation
 * @param c - Target context
 * @param node - Resolved array
 * @param value - Exact constant
 * @returns JSON array
 */
function arrayConstant(c: CSharpContext, node: ArrayType, value: Constant): string {
  if (value.kind !== "array") return constant(value);
  return `[${value.items.map((item) => wireConstant(c, node.element, item)).join(",")}]`;
}

/** Object constant keyed by wire names with every member in its own representation
 * @param c - Target context
 * @param node - Resolved object
 * @param value - Exact constant
 * @returns JSON object
 */
function objectConstant(c: CSharpContext, node: ObjectType, value: Constant): string {
  if (value.kind !== "object") return constant(value);
  const members = sortedKeys(value.properties).map((key) => {
    const field = node.fields.find(
      (candidate) => candidate.name === key || candidate.wireName === key,
    );
    const member = value.properties[key]!;
    return `${JSON.stringify(field?.wireName ?? key)}:${field ? wireConstant(c, field.type, member) : constant(member)}`;
  });
  return `{${members.join(",")}}`;
}

/** Union constant rendered through the variant selected by its discriminator
 * @param c - Target context
 * @param node - Resolved union
 * @param value - Exact constant
 * @returns JSON object
 */
function unionConstant(c: CSharpContext, node: UnionType, value: Constant): string {
  if (value.kind !== "object") return constant(value);
  const tag = value.properties[node.discriminator];
  const variant = node.variants.find(
    (candidate) => tag?.kind === "string" && candidate.tag === tag.value,
  );
  return variant ? wireConstant(c, variant.type, value) : constant(value);
}

/** Provider default as the HTTP JSON text its generated reader accepts
 * @param c - Target context
 * @param use - Resolved default type
 * @param value - Exact constant accepted by the profile
 * @returns JSON text that cannot fail for any value the profile accepted
 */
export function wireConstant(c: CSharpContext, use: TypeUse, value: Constant): string {
  if (value.kind === "null") return "null";
  const node = c.node(use.id);
  switch (node.kind) {
    case "scalar":
      return scalarConstant(node, use.encodings?.http ?? node.encodings.http, value);
    case "array":
      return arrayConstant(c, node, value);
    case "object":
      return objectConstant(c, node, value);
    case "union":
      return unionConstant(c, node, value);
    case "literal":
    case "enum":
      return constant(value);
  }
}
