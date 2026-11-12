import type { Encoding, ScalarKind, ScalarType } from "../model/contract-model.js";
import { constraintSchema } from "./constraint-schema.js";
import type { JsonObject } from "./reference-document.js";

/** Scalar meanings whose JSON number form is exact only through a numeric token */
const numericScalars: readonly ScalarKind[] = [
  "int32",
  "int64",
  "uint64",
  "integer",
  "decimal",
  "float32",
  "float64",
];
/** Numeric scalar meanings without a fractional part */
const integerScalars: readonly ScalarKind[] = ["int32", "int64", "uint64", "integer"];

/** Numeric scalar membership
 * @param scalar - Resolved scalar meaning
 * @returns Whether the meaning has a JSON number representation
 */
export function isNumericScalar(scalar: ScalarKind): boolean {
  return numericScalars.includes(scalar);
}

/** JSON Schema primitive type of a scalar representation
 * @param scalar - Resolved scalar meaning
 * @param encodedNumber - Number token rather than text on the wire
 * @returns Schema primitive type name
 */
function primitiveType(scalar: ScalarKind, encodedNumber: boolean): string {
  if (scalar === "boolean") return "boolean";
  if (!encodedNumber) return "string";
  return integerScalars.includes(scalar) ? "integer" : "number";
}

/** Scalar wire shape with explicit preservation metadata
 * @param node - Resolved scalar meaning
 * @param encoding - Effective binding-local representation
 * @returns Reference schema for that representation
 */
export function scalarSchema(node: ScalarType, encoding: Encoding): JsonObject {
  const encodedNumber =
    (isNumericScalar(node.scalar) && encoding === "json") || encoding === "unixTimestamp";
  const result: JsonObject = {
    type: primitiveType(node.scalar, encodedNumber),
    ...constraintSchema(node.constraints, encodedNumber),
    "x-contract-scalar": node.scalar,
    "x-contract-encoding": encoding,
  };
  if (node.role !== null) result["x-contract-role"] = node.role;
  if (node.preserveLexical) result["x-contract-preserve-lexical"] = true;
  if ((node.scalar === "offsetDateTime" || node.scalar === "utcDateTime") && !encodedNumber)
    result.format = "date-time";
  if (node.scalar === "plainDate") result.format = "date";
  if (node.scalar === "plainTime") result.format = "time";
  if (node.scalar === "duration") result.format = "duration";
  if (node.scalar === "bytes")
    result.contentEncoding = encoding === "base64url" ? "base64url" : "base64";
  return result;
}
