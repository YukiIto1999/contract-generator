import type { Constraints, ContractType, ScalarType, TypeUse } from "../../model/contract-model.js";
import { node, type RustContext } from "./context.js";
import { key, quote } from "./naming.js";
import { rustPattern } from "./patterns.js";
import { exactNumeric } from "./storage.js";

/** Inclusive storage range of each native integer, spelled as JSON numbers */
const integerBounds: Readonly<Record<string, readonly [string, string]>> = {
  int32: ["-2147483648", "2147483647"],
  int64: ["-9223372036854775808", "9223372036854775807"],
  uint64: ["0", "18446744073709551615"],
};

/** Temporal scalar meanings validated lexically */
const temporalKinds: Readonly<Record<string, true>> = {
  offsetDateTime: true,
  utcDateTime: true,
  plainDate: true,
  plainTime: true,
  duration: true,
};

/** Rust optional literal expression
 * @param value - Optional source literal
 * @returns Rust Option expression
 */
export function optional(value: number | undefined): string {
  return value === undefined ? "None" : `Some(${value})`;
}

/** Borrowed storage of a scalar behind its nominal role
 * @param type - Resolved declaration
 * @param expression - Borrowed typed expression
 * @returns Expression of the borrowed raw storage
 */
function storageOf(type: ContractType, expression: string): string {
  return type.kind === "scalar" && type.role !== null ? `&(${expression}).0` : expression;
}

/** Length restrictions of text and bytes
 * @param type - Resolved declaration
 * @param constraints - Restrictions to apply
 * @param value - Borrowed storage expression
 * @param path - Rust pointer expression
 * @returns Validation statements
 */
function lengthChecks(
  type: ContractType,
  constraints: Constraints,
  value: string,
  path: string,
): string[] {
  const { minLength, maxLength } = constraints;
  if (minLength === undefined && maxLength === undefined) return [];
  if (type.kind !== "scalar" || type.scalar !== "bytes")
    return [
      `check_text(${value}, ${optional(minLength)}, ${optional(maxLength)}, ${path}, state);`,
    ];
  const lines: string[] = [];
  if (minLength !== undefined)
    lines.push(`if (${value}).len() < ${minLength} { state.reject(${path}, "minLength"); }`);
  if (maxLength !== undefined)
    lines.push(`if (${value}).len() > ${maxLength} { state.reject(${path}, "maxLength"); }`);
  return lines;
}

/** Whether both numeric bounds fit a native comparison in 128-bit integers
 * @param constraints - Restrictions to apply
 * @returns True when every present bound is an integer spelling within i128
 */
function nativeBounds(constraints: Constraints): boolean {
  return [constraints.minimum, constraints.maximum].every(
    (bound) =>
      bound === undefined ||
      (/^-?[0-9]+$/.test(bound.value) &&
        BigInt(bound.value) >= -(1n << 127n) &&
        BigInt(bound.value) < 1n << 127n),
  );
}

/** Numeric interval restrictions in native or exact arithmetic
 * @param type - Resolved declaration
 * @param constraints - Restrictions to apply
 * @param value - Borrowed storage expression
 * @param path - Rust pointer expression
 * @returns Validation statements
 */
function rangeChecks(
  type: ContractType,
  constraints: Constraints,
  value: string,
  path: string,
): string[] {
  const { minimum, maximum } = constraints;
  if (minimum === undefined && maximum === undefined) return [];
  const exact = type.kind === "scalar" && exactNumeric(type);
  if (
    type.kind === "scalar" &&
    integerBounds[type.scalar] !== undefined &&
    !exact &&
    nativeBounds(constraints)
  ) {
    const lines: string[] = [];
    if (minimum !== undefined)
      lines.push(
        `if (*(${value}) as i128) ${minimum.exclusive ? "<=" : "<"} ${minimum.value}_i128 { state.reject(${path}, "minimum"); }`,
      );
    if (maximum !== undefined)
      lines.push(
        `if (*(${value}) as i128) ${maximum.exclusive ? ">=" : ">"} ${maximum.value}_i128 { state.reject(${path}, "maximum"); }`,
      );
    return lines;
  }
  const text = exact ? `(${value}).as_str()` : `&(${value}).to_string()`;
  const bound = (limit: typeof minimum): string =>
    limit === undefined ? "None" : `Some(${quote(limit.value)})`;
  return [
    `check_number(${text}, ${bound(minimum)}, ${minimum?.exclusive === true}, ${bound(maximum)}, ${maximum?.exclusive === true}, ${path}, state);`,
  ];
}

/** Format and pattern restrictions of text
 * @param constraints - Restrictions to apply
 * @param value - Borrowed storage expression
 * @param path - Rust pointer expression
 * @returns Validation statements
 */
function formatChecks(constraints: Constraints, value: string, path: string): string[] {
  const lines: string[] = [];
  if (constraints.format === "uuid")
    lines.push(
      `if !pattern!(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$").is_match(${value}) { state.reject(${path}, "format"); }`,
    );
  const pattern = constraints.pattern === undefined ? undefined : rustPattern(constraints.pattern);
  if (pattern !== undefined)
    lines.push(
      `if !pattern!(${quote(pattern)}).is_match(${value}) { state.reject(${path}, "format"); }`,
    );
  return lines;
}

/** Constraint checks on already-owned typed storage
 * @param type - Resolved value declaration
 * @param constraints - Additional restrictions
 * @param expression - Borrowed typed expression
 * @param path - Rust pointer expression
 * @returns Validation statements
 */
export function checks(
  type: ContractType,
  constraints: Constraints,
  expression: string,
  path: string,
): string {
  const value = storageOf(type, expression);
  const lines = [...lengthChecks(type, constraints, value, path)];
  if (constraints.minItems !== undefined || constraints.maxItems !== undefined)
    lines.push(
      `check_items((${value})${type.kind === "array" ? ".as_slice()" : ""}.len(), ${optional(constraints.minItems)}, ${optional(constraints.maxItems)}, ${path}, state);`,
    );
  lines.push(
    ...rangeChecks(type, constraints, value, path),
    ...formatChecks(constraints, value, path),
  );
  return lines.join("\n");
}

/** Domain checks of a numeric scalar that retains its source spelling
 * @param type - Scalar stored as an exact number token
 * @param value - Borrowed storage expression
 * @param path - Rust pointer expression
 * @returns Validation statement, or an empty string when the domain is unrestricted
 */
function exactDomain(type: ScalarType, value: string, path: string): string {
  const text = `(${value}).as_str()`;
  const bounds = integerBounds[type.scalar];
  if (type.scalar === "integer") return `check_integer(${text}, ${path}, state);`;
  if (bounds !== undefined) {
    const { minimum, maximum } = type.constraints;
    const limit = (side: string, spelled: string): string =>
      `check_number(${text}, ${side === "min" ? `Some(${quote(spelled)}), false, None, false` : `None, false, Some(${quote(spelled)}), false`}, ${path}, state);`;
    return [
      `check_integer(${text}, ${path}, state);`,
      minimum === undefined ? limit("min", bounds[0]) : "",
      maximum === undefined ? limit("max", bounds[1]) : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (type.scalar === "float32" || type.scalar === "float64") {
    const bounded =
      type.constraints.minimum !== undefined && type.constraints.maximum !== undefined;
    return bounded ? "" : `check_float(${text}, ${type.scalar === "float32"}, ${path}, state);`;
  }
  return "";
}

/** Primitive invariant checks independent from the binding
 * @param type - Scalar contract
 * @param expression - Borrowed public representation
 * @param path - Pointer expression
 * @returns Validation statements
 */
export function scalarChecks(type: ScalarType, expression: string, path: string): string {
  const value = storageOf(type, expression);
  const lines = [checks(type, type.constraints, expression, path)];
  if (temporalKinds[type.scalar] === true)
    lines.push(
      `if !temporal(${value}, ${quote(type.scalar)}) { state.reject(${path}, "format"); }`,
    );
  if (exactNumeric(type)) lines.push(exactDomain(type, value, path));
  else if (type.scalar === "float32" || type.scalar === "float64")
    lines.push(`if !(${value}).is_finite() { state.reject(${path}, "type"); }`);
  return lines.filter(Boolean).join("\n");
}

/** Whether a scalar declaration owns base checks of its own
 * @param type - Resolved declaration
 * @returns True when construction and decoding of the scalar validate anything beyond its representation
 */
export function hasBaseChecks(type: ContractType): boolean {
  return type.kind === "scalar" && scalarChecks(type, "value", '""') !== "";
}

/** Whether holders must repeat the base checks of a scalar on storage they received unvalidated
 * @param type - Resolved declaration
 * @returns True for an alias or an inherited role with base checks; a distinct role is validated at construction
 */
export function needsBaseCheck(type: ContractType): boolean {
  return type.kind === "scalar" && type.role !== type.id && hasBaseChecks(type);
}

/** Completion checks of one non-null value: the declaration's base checks plus the use-site restrictions
 * @param ctx - Resolved generation context
 * @param use - Field, element or payload semantics
 * @param path - Pointer expression
 * @returns Validation statements over the borrowed `value`, or an empty string when nothing restricts the use
 */
export function useBody(ctx: RustContext, use: TypeUse, path: string): string {
  const type = node(ctx, use.id);
  const base = needsBaseCheck(type) ? `_check_${key(type)}(value, ${path}, state);` : "";
  return [base, checks(type, use.constraints, "value", path)].filter(Boolean).join("\n");
}

/** Completion checks of one value use
 * @param ctx - Resolved generation context
 * @param use - Field, element or payload semantics
 * @param source - Expression of the borrowed use value, an Option reference when the use is nullable
 * @param path - Pointer expression
 * @returns Validation statements, or an empty string when nothing restricts the use
 */
export function completeUse(ctx: RustContext, use: TypeUse, source: string, path: string): string {
  const body = useBody(ctx, use, path);
  if (body === "") return "";
  return use.nullable
    ? `if let Some(value) = ${source} { ${body} }`
    : source === "value"
      ? body
      : `{ let value = ${source}; ${body} }`;
}

/** Violation scope asserting that a value carries none
 * @param checksBody - Generated validation statements
 * @param subject - Description reported by a defect
 * @returns Rust statements that panic when a violation is collected
 */
export function asserted(checksBody: string, subject: string): string {
  return `let mut state = State::default(); { let state = &mut state; ${checksBody} } assert_valid(&state, ${quote(subject)});`;
}

/** Violation scope yielding an accepted value or the collected violations
 * @param checksBody - Generated validation statements
 * @param result - Rust expression of the candidate Option published after validation
 * @returns Rust expression of the accepted outcome
 */
export function finished(checksBody: string, result: string): string {
  return checksBody.trim() === ""
    ? `State::default().finish(${result})`
    : `{ let mut state = State::default(); { let state = &mut state; ${checksBody} } state.finish(${result}) }`;
}
