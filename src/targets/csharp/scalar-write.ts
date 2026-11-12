import type { ScalarType } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";

/** Text of a stored number in the invariant spelling
 * @param c - Target context
 * @param node - Number scalar
 * @param value - Storage expression
 * @returns Expression of the number's JSON token
 */
function numberText(c: CSharpContext, node: ScalarType, value: string): string {
  if (c.storage(node) === "ExactDecimal") return `${value}.Text`;
  return node.scalar === "float32" || node.scalar === "float64"
    ? `${value}.ToString("R", CultureInfo.InvariantCulture)`
    : `${value}.ToString(CultureInfo.InvariantCulture)`;
}

/** Scalar wire output
 * @param c - Target context
 * @param node - Scalar meaning
 * @param value - Storage expression
 * @returns Writer statements over `writer` and `encoding`
 */
export function scalarWrite(c: CSharpContext, node: ScalarType, value: string): string {
  switch (node.scalar) {
    case "string":
    case "offsetDateTime":
    case "utcDateTime":
    case "plainDate":
    case "plainTime":
    case "duration":
      return `writer.WriteStringValue(${value});`;
    case "boolean":
      return `if (encoding == "string") writer.WriteStringValue(${value} ? "true" : "false"); else writer.WriteBooleanValue(${value});`;
    case "bytes":
      return `if (encoding == "base64url") writer.WriteStringValue(System.Buffers.Text.Base64Url.EncodeToString(${value}.AsSpan())); else writer.WriteBase64StringValue(${value}.AsSpan());`;
    case "int32":
    case "int64":
    case "uint64":
    case "integer":
    case "decimal":
    case "float32":
    case "float64":
      return `string text = ${numberText(c, node, value)};\nif (encoding == "string") writer.WriteStringValue(text); else writer.WriteRawValue(text);`;
  }
}
