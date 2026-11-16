import type { Constraints, TypeUse } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, quote } from "./naming.js";
import { patternReference } from "./patterns.js";

/** Scalar meanings whose standard C# storage prints as an invariant integer */
const integerScalars: Readonly<Record<string, true>> = {
  int32: true,
  int64: true,
  uint64: true,
  integer: true,
};

/** Numeric token expression of a stored number
 * @param c - Target context
 * @param id - Resolved scalar identity
 * @param value - Storage expression
 * @returns Expression of the exact decimal spelling
 */
function numericText(c: CSharpContext, id: string, value: string): string {
  const node = c.node(id);
  if (node.kind !== "scalar") return `${value}.ToString("R", CultureInfo.InvariantCulture)`;
  const storage = c.storage(node);
  if (storage === "ExactDecimal") return `${value}.Text`;
  return integerScalars[node.scalar] === true
    ? `${value}.ToString(CultureInfo.InvariantCulture)`
    : `${value}.ToString("R", CultureInfo.InvariantCulture)`;
}

/** Length restrictions on array elements or bytes
 * @param rules - Restrictions
 * @param value - Storage expression
 * @param path - Pointer expression
 * @returns Validation statements
 */
function itemConstraints(rules: Constraints, value: string, path: string): string {
  return lines(
    rules.minItems !== undefined &&
      `if (${value}.Length < ${rules.minItems}) c.Add(${path}, "minItems");`,
    rules.maxItems !== undefined &&
      `if (${value}.Length > ${rules.maxItems}) c.Add(${path}, "maxItems");`,
  );
}

/** Numeric range restriction with exact boundaries
 * @param c - Target context
 * @param id - Resolved scalar identity
 * @param rules - Restrictions
 * @param value - Storage expression
 * @param path - Pointer expression
 * @returns Validation statement, or nothing when the range is unrestricted
 */
function rangeConstraint(
  c: CSharpContext,
  id: string,
  rules: Constraints,
  value: string,
  path: string,
): string {
  const { minimum, maximum } = rules;
  if (minimum === undefined && maximum === undefined) return "";
  const bound = (limit: typeof minimum): string =>
    `${limit === undefined ? "null" : quote(limit.value)}, ${limit?.exclusive === true}`;
  return `Wire.Range(${numericText(c, id, value)}, ${bound(minimum)}, ${bound(maximum)}, c, ${path});`;
}

/** Constraint source generation
 * @param c - Target context
 * @param id - Resolved value identity
 * @param rules - Restrictions
 * @param value - Nonnullable representation
 * @param path - Pointer expression
 * @returns Validation statements
 */
export function constraints(
  c: CSharpContext,
  id: string,
  rules: Constraints,
  value: string,
  path = "path",
): string {
  const node = c.node(id);
  const scalar = node.kind === "scalar" ? node : undefined;
  const textual = scalar !== undefined && c.storage(scalar) === "string";
  const countable = node.kind === "array" || scalar?.scalar === "bytes";
  return lines(
    textual &&
      `Wire.Text(${value}, ${rules.minLength ?? "null"}, ${rules.maxLength ?? "null"}, ${rules.format === "uuid"}, ${patternReference(c, rules.pattern)}, c, ${path});`,
    countable && itemConstraints(rules, value, path),
    rangeConstraint(c, id, rules, value, path),
  );
}

/** Use-site checks shared by construction and decoding of one position */
export interface UseCheck {
  /** Statement that checks a value at this position, or nothing when decoding already did
   * @param value - Candidate expression
   * @param path - Pointer expression
   * @param decoded - Whether decoding already validated the value against its own type
   * @param owner - Qualified codec class that declares the shared method, when called from elsewhere
   * @returns Statement source
   */
  call(value: string, path: string, decoded: boolean, owner?: string): string;
  /** Shared method declaration, or nothing when the use adds no restriction */
  readonly declaration: string;
}

/** Use-site restriction statements applied to a value that is already valid for its type
 * @param c - Target context
 * @param use - Type use
 * @returns Statements over `value` and `path`, or nothing without restrictions
 */
function restrictions(c: CSharpContext, use: TypeUse): string {
  if (Object.keys(use.constraints).length === 0) return "";
  const node = c.node(use.id);
  const raw = c.unwrap(use, "value");
  const target = node.kind === "scalar" && node.role !== null ? `${raw}.Value` : raw;
  return constraints(c, use.id, use.constraints, target);
}

/** Shared use-site check method of one position
 * @param c - Target context
 * @param method - Unescaped method identifier within the owning codec class
 * @param use - Type use
 * @param subject - Prose naming the position
 * @returns Method declaration
 */
function checkMethod(c: CSharpContext, method: string, use: TypeUse, subject: string): string {
  const absent = c.valueType(use.id) ? "!value.HasValue" : "value is null";
  return lines(
    doc(`Use-site restrictions of ${subject} for construction and decoding`, [
      "value",
      "c",
      "path",
      "decoded",
    ]),
    `internal static void ${method}(${c.use(use)} value, ReadContext c, Wire.Path path, bool decoded) {`,
    use.nullable && `if (${absent}) return;`,
    "int before = c.ViolationCount;",
    `if (!decoded) ${c.codec(use.id)}.Check(${c.unwrap(use, "value")}, c, path);`,
    `if (c.ViolationCount == before) { ${restrictions(c, use)} }`,
    "}",
  );
}

/** Position check generated once and called by every path that fills the position
 * @param c - Target context
 * @param method - Unescaped method identifier within the owning codec class
 * @param use - Type use
 * @param subject - Prose naming the position
 * @returns Call generator and shared declaration
 */
export function useCheck(
  c: CSharpContext,
  method: string,
  use: TypeUse,
  subject: string,
): UseCheck {
  const restricted = restrictions(c, use) !== "";
  return {
    declaration: restricted ? checkMethod(c, method, use, subject) : "",
    call(value, path, decoded, owner) {
      if (restricted)
        return `${owner === undefined ? "" : owner + "."}${method}(${value}, c, ${path}, ${decoded});`;
      if (decoded) return "";
      const base = `${c.codec(use.id)}.Check(${c.unwrap(use, value)}, c, ${path});`;
      return use.nullable ? `if (${value} is not null) ${base}` : base;
    },
  };
}
