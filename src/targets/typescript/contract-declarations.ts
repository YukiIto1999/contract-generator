import type { ContractType, ObjectType, ScalarType } from "../../model/contract-model.js";
import { literalType } from "./contract-literals.js";
import { preservesUnix, referenceType, type ContractContext } from "./contract-context.js";
import { docText, indent, lines, quote, tsdoc } from "./source-text.js";

/**
 * Representation of a scalar independent of its nominal role
 * @param type - Scalar declaration
 * @returns Type expression
 */
function representationType(type: ScalarType): string {
  const branded = (name: string): string =>
    `string & { readonly [representation]: ${quote(name)} }`;
  switch (type.scalar) {
    case "string":
      return "string";
    case "boolean":
      return "boolean";
    case "int32":
    case "float32":
    case "float64":
      return type.preserveLexical ? branded(type.scalar) : "number";
    case "int64":
    case "uint64":
      return type.preserveLexical ? branded("integer") : "bigint";
    case "integer":
      return branded("integer");
    case "decimal":
      return branded("decimal");
    case "bytes":
      return "ByteSequence";
    case "offsetDateTime":
    case "utcDateTime":
    case "plainDate":
    case "plainTime":
    case "duration":
      return branded(type.scalar);
  }
}

/**
 * Object shape with documented readonly members
 * @param context - Generation state
 * @param type - Object declaration
 * @returns Object type expression carrying the declaration identity
 */
function objectShape(context: ContractContext, type: ObjectType): string {
  const members = type.fields.map((field) =>
    lines(
      `/** ${docText(field.description, "Contract field value")} */`,
      `readonly ${quote(field.name)}${field.optional ? "?" : ""}: ${referenceType(context, field.type)};`,
    ),
  );
  return lines("{", indent(lines(members, `readonly [declaration]: ${quote(type.id)};`)), "}");
}

/**
 * Right-hand side of a public type declaration
 * @param context - Generation state
 * @param type - Declaration
 * @returns Type expression
 */
function shapeOf(context: ContractContext, type: ContractType): string {
  switch (type.kind) {
    case "scalar":
      return `${representationType(type)}${type.role === null ? "" : ` & { readonly [role]: ${quote(type.role)} }`}`;
    case "object":
      return objectShape(context, type);
    case "array":
      return `ReadonlyArray<${referenceType(context, type.element)}> & { readonly [declaration]: ${quote(type.id)} }`;
    case "union":
      return (
        type.variants.map((variant) => `(${referenceType(context, variant.type)})`).join(" | ") ||
        "never"
      );
    case "literal":
      return literalType(type.value);
    case "enum":
      return type.members.map((member) => literalType(member.value)).join(" | ") || "never";
  }
}

/**
 * Documented public type declaration
 * @param context - Generation state
 * @param type - Declaration
 * @returns Exported type alias
 */
export function declarationSource(context: ContractContext, type: ContractType): string {
  const preserved = type.kind === "scalar" && preservesUnix(context, type);
  const remarks =
    "Preserved RFC3339 source spelling or exact Unix seconds token according to the accepted binding";
  const summary = docText(type.description, "Immutable public contract value");
  const doc = tsdoc(summary, preserved ? { remarks } : {});
  return lines(doc, `export type ${type.name} = ${shapeOf(context, type)};`);
}
