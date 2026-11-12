import type { ScalarType } from "../../model/contract-model.js";
import { constraints } from "./checks.js";
import type { CSharpContext } from "./context.js";
import { lines, quote } from "./naming.js";

/** Inclusive standard-integer domains by scalar meaning */
const integerDomains: Readonly<Record<string, readonly [string, string]>> = {
  int32: ["-2147483648", "2147483647"],
  int64: ["-9223372036854775808", "9223372036854775807"],
  uint64: ["0", "18446744073709551615"],
};

/** Inclusive domain of a bounded standard integer
 * @param scalar - Scalar meaning
 * @returns Lower and upper spelling, or undefined for unbounded meanings
 */
export function integerDomain(scalar: ScalarType["scalar"]): readonly [string, string] | undefined {
  return integerDomains[scalar];
}

/** Calendar and clock checks of a textual scalar
 * @param scalar - Scalar meaning
 * @param value - String expression
 * @returns Validation statement, or nothing for plain text
 */
function temporalCheck(scalar: ScalarType["scalar"], value: string): string {
  const format = (valid: string): string => `if (!${valid}) c.Add(path, "format");`;
  switch (scalar) {
    case "offsetDateTime":
      return format(`Wire.DateTimeText(${value}, false)`);
    case "utcDateTime":
      return format(`Wire.DateTimeText(${value}, true)`);
    case "plainDate":
      return format(`Wire.DateTimeText(${value} + "T00:00:00Z", false)`);
    case "plainTime":
      return format(`Wire.DateTimeText("2000-01-01T" + ${value} + "Z", false)`);
    case "duration":
      return format(`Wire.DurationText(${value})`);
    case "string":
    case "boolean":
    case "int32":
    case "int64":
    case "uint64":
    case "integer":
    case "decimal":
    case "float32":
    case "float64":
    case "bytes":
      return "";
  }
}

/** Finite floating-point check over native or exact-decimal storage
 * @param c - Target context
 * @param node - Float scalar
 * @param value - Storage expression
 * @returns Validation statement
 */
function finiteCheck(c: CSharpContext, node: ScalarType, value: string): string {
  const storage = c.storage(node);
  const native = node.scalar === "float32" ? "float" : "double";
  if (storage !== "ExactDecimal")
    return `if (!${storage}.IsFinite(${value})) c.Add(path, "format");`;
  return `if (!${native}.TryParse(${value}.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var finite) || !${native}.IsFinite(finite)) c.Add(path, "format");`;
}

/** Integral and range checks of an exact-decimal stored integer
 * @param node - Integer scalar
 * @param value - Storage expression
 * @returns Validation statements
 */
function exactIntegerCheck(node: ScalarType, value: string): string {
  const domain = integerDomain(node.scalar);
  return lines(
    `if (!Wire.IsInteger(${value}.Text)) c.Add(path, "format");`,
    domain &&
      `Wire.Range(${value}.Text, ${quote(domain[0])}, false, ${quote(domain[1])}, false, c, path);`,
  );
}

/** Checks of a number, bytes or exact-decimal scalar after its presence guard
 * @param c - Target context
 * @param node - Scalar node
 * @param value - Storage expression
 * @returns Validation statements
 */
function numericCheck(c: CSharpContext, node: ScalarType, value: string): string {
  const exact = c.storage(node) === "ExactDecimal";
  const floating = node.scalar === "float32" || node.scalar === "float64";
  return lines(
    floating && finiteCheck(c, node, value),
    (exact && integerDomain(node.scalar) !== undefined) || (exact && node.scalar === "integer")
      ? exactIntegerCheck(node, value)
      : "",
    constraints(c, node.id, node.constraints, value),
  );
}

/** Guard that rejects an uninitialized storage value before the remaining checks
 * @param c - Target context
 * @param node - Scalar node
 * @param value - Storage expression
 * @param inner - Checks that apply to an initialized value
 * @returns Guarded validation statements
 */
function guarded(c: CSharpContext, node: ScalarType, value: string, inner: string): string {
  const storage = c.storage(node);
  if (storage === "string")
    return `if (${value} is null) { c.Add(path, "null"); } else {\n${inner}\n}`;
  if (storage === "ExactDecimal")
    return `if (!${value}.IsInitialized) { c.Add(path, "required"); } else {\n${inner}\n}`;
  if (node.scalar === "bytes")
    return `if (${value}.IsDefault) { c.Add(path, "required"); } else {\n${inner}\n}`;
  return inner;
}

/** Scalar intrinsic validation shared by construction, decoding and output
 * @param c - Target context
 * @param node - Scalar node
 * @param value - Storage expression
 * @returns Validation statements over `c` and `path`
 */
export function scalarCheck(c: CSharpContext, node: ScalarType, value: string): string {
  const inner =
    c.storage(node) === "string"
      ? lines(constraints(c, node.id, node.constraints, value), temporalCheck(node.scalar, value))
      : numericCheck(c, node, value);
  return guarded(c, node, value, inner);
}
