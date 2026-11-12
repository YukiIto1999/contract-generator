import type { ScalarType } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { lines, quote } from "./naming.js";
import { integerDomain } from "./scalar-checks.js";

/** Rejection of a value whose JSON kind does not match the scalar
 * @returns Statements that record the kind violation and abandon the candidate
 */
function reject(): string {
  return `c.Add(path, element.ValueKind == JsonValueKind.Null ? "null" : "type"); return default!;`;
}

/** Reader of a text-represented scalar
 * @returns Statements that bind `value`
 */
function readText(): string {
  return lines(
    `if (element.ValueKind != JsonValueKind.String) { ${reject()} }`,
    "if (!Wire.TryString(element, c, path, out var value)) return default!;",
  );
}

/** Reader of a boolean in either binding representation
 * @returns Statements that bind `value`
 */
function readBoolean(): string {
  return lines(
    "bool value;",
    `if (encoding == "string") {`,
    `if (element.ValueKind != JsonValueKind.String) { ${reject()} }`,
    "if (!Wire.TryString(element, c, path, out var text)) return default!;",
    `if (text is not "true" and not "false") { c.Add(path, "format"); return default!; }`,
    `value = text == "true";`,
    "} else {",
    `if (element.ValueKind is not JsonValueKind.True and not JsonValueKind.False) { ${reject()} }`,
    "value = element.GetBoolean();",
    "}",
  );
}

/** Reader of bytes in the binding's alphabet
 * @returns Statements that bind `value`
 */
function readBytes(): string {
  return lines(
    `if (element.ValueKind != JsonValueKind.String) { ${reject()} }`,
    "if (!Wire.TryString(element, c, path, out var encodedBytes)) return default;",
    `if (!Wire.Bytes(encodedBytes, encoding == "base64url", out var value)) { c.Add(path, "format"); return default; }`,
  );
}

/** Numeric token extraction in the binding's number or string representation
 * @returns Statements that bind `text`
 */
function readNumberToken(): string {
  return lines(
    `if (encoding == "string" ? element.ValueKind != JsonValueKind.String : element.ValueKind != JsonValueKind.Number) { ${reject()} }`,
    "string text;",
    "if (element.ValueKind == JsonValueKind.String) { if (!Wire.TryString(element, c, path, out text)) return default!; } else text = element.GetRawText();",
  );
}

/** Reader of a standard integer with exact domain checks before conversion
 * @param storage - Native integer storage
 * @param domain - Inclusive lower and upper spelling
 * @returns Statements that bind `value`
 */
function readStandardInteger(storage: string, domain: readonly [string, string]): string {
  return lines(
    readNumberToken(),
    `if (!Wire.NumberPattern.IsMatch(text) || !Wire.IsInteger(text)) { c.Add(path, "format"); return default!; }`,
    `if (Wire.Compare(text, ${quote(domain[0])}) < 0) { c.Add(path, "minimum"); return default!; }`,
    `if (Wire.Compare(text, ${quote(domain[1])}) > 0) { c.Add(path, "maximum"); return default!; }`,
    `if (!Wire.TryInteger(text, out var integer)) { c.Add(path, "format"); return default!; }`,
    `${storage} value = (${storage})integer;`,
  );
}

/** Reader of an exact-decimal or floating-point number
 * @param storage - Native or exact-decimal storage
 * @returns Statements that bind `value`
 */
function readNumber(storage: string): string {
  const exact = storage === "ExactDecimal";
  const parse = exact
    ? "Wire.NumberPattern.IsMatch(text)"
    : `${storage}.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)`;
  return lines(
    readNumberToken(),
    `if (!(${parse})) { c.Add(path, "format"); return default!; }`,
    `${storage} value = ${exact ? "ExactDecimal.Complete(text)" : "parsed"};`,
  );
}

/** Scalar standard-parser extraction
 * @param c - Target context
 * @param node - Scalar meaning
 * @returns Reader statements that bind `value`
 */
export function scalarRead(c: CSharpContext, node: ScalarType): string {
  const storage = c.storage(node);
  if (storage === "string") return readText();
  if (node.scalar === "boolean") return readBoolean();
  if (node.scalar === "bytes") return readBytes();
  const domain = integerDomain(node.scalar);
  if (domain !== undefined && storage !== "ExactDecimal")
    return readStandardInteger(storage, domain);
  return readNumber(storage);
}
