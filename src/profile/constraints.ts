import {
  Numeric,
  getFormat,
  getMaxItemsAsNumeric,
  getMaxLengthAsNumeric,
  getMaxValueAsNumeric,
  getMaxValueExclusiveAsNumeric,
  getMaxValueExclusiveForScalar,
  getMaxValueForScalar,
  getMinItemsAsNumeric,
  getMinLengthAsNumeric,
  getMinValueAsNumeric,
  getMinValueExclusiveAsNumeric,
  getMinValueExclusiveForScalar,
  getMinValueForScalar,
  getNamespaceFullName,
  getPattern,
  type Program,
  type Type,
} from "@typespec/compiler";
import type { Bound, Constraints } from "../model/contract-model.js";
import type { IssueSink } from "./issue-sink.js";
import type { MutableConstraints } from "./numeric-bounds.js";
import type { ExactNumber } from "./numbers.js";

/**
 * Direct restrictions from resolved compiler state without inherited-value replacement
 * @param program - Fully checked compiler program
 * @param target - Declaration or property owning the restrictions
 * @param issue - Source-addressed failure accumulator
 * @param exactNumber - Compiler syntax provenance for numeric decorator arguments
 * @returns Direct restrictions with exact decimal boundaries
 */
export function readConstraints(
  program: Program,
  target: Type,
  issue: IssueSink,
  exactNumber: ExactNumber,
): Constraints {
  const result = readBounds(program, target, exactNumber);
  readCardinalities(program, target, issue, result);
  readFormat(program, target, issue, result);
  readPattern(program, target, issue, result);
  rejectScalarBounds(program, target, issue);
  return result;
}

/**
 * Numeric boundaries keeping the stricter of the inclusive and exclusive spellings
 * @param program - Fully checked compiler program
 * @param target - Declaration or property owning the restrictions
 * @param exactNumber - Compiler syntax provenance for numeric decorator arguments
 * @returns Restrictions holding only the numeric boundaries
 */
function readBounds(program: Program, target: Type, exactNumber: ExactNumber): MutableConstraints {
  const exact = (decorator: string, resolved: Numeric | undefined) =>
    exactNumericConstraint(target, decorator, resolved, exactNumber);
  const minimum = selectBound(
    exact("@minValue", getMinValueAsNumeric(program, target)),
    exact("@minValueExclusive", getMinValueExclusiveAsNumeric(program, target)),
    true,
  );
  const maximum = selectBound(
    exact("@maxValue", getMaxValueAsNumeric(program, target)),
    exact("@maxValueExclusive", getMaxValueExclusiveAsNumeric(program, target)),
    false,
  );
  return { ...(minimum ? { minimum } : {}), ...(maximum ? { maximum } : {}) };
}

/**
 * Stricter side of an inclusive and an exclusive declaration
 * @param included - Inclusive declaration for this side
 * @param excluded - Exclusive declaration for this side
 * @param lower - Lower side rather than upper side
 * @returns The binding boundary, preferring the exclusive spelling when it is at least as strict
 */
function selectBound(
  included: Numeric | undefined,
  excluded: Numeric | undefined,
  lower: boolean,
): Bound | undefined {
  if (excluded && (!included || (lower ? excluded.gte(included) : excluded.lte(included))))
    return { value: excluded.toString(), exclusive: true };
  return included ? { value: included.toString(), exclusive: false } : undefined;
}

/**
 * Length and item-count restrictions as nonnegative safe integers
 * @param program - Fully checked compiler program
 * @param target - Declaration or property owning the restrictions
 * @param issue - Source-addressed failure accumulator
 * @param result - Restrictions receiving the cardinalities
 */
function readCardinalities(
  program: Program,
  target: Type,
  issue: IssueSink,
  result: MutableConstraints,
): void {
  for (const [key, value] of [
    ["minLength", getMinLengthAsNumeric(program, target)],
    ["maxLength", getMaxLengthAsNumeric(program, target)],
    ["minItems", getMinItemsAsNumeric(program, target)],
    ["maxItems", getMaxItemsAsNumeric(program, target)],
  ] as const) {
    if (!value) continue;
    const count = value.asNumber();
    if (count === null || !Number.isSafeInteger(count) || count < 0)
      issue("invalid-cardinality", target, `${key} must be a nonnegative safe integer`);
    else result[key] = count;
  }
}

/**
 * Semantic format restriction limited to the registered formats
 * @param program - Fully checked compiler program
 * @param target - Declaration or property owning the restriction
 * @param issue - Source-addressed failure accumulator
 * @param result - Restrictions receiving the format
 */
function readFormat(
  program: Program,
  target: Type,
  issue: IssueSink,
  result: MutableConstraints,
): void {
  const format = getFormat(program, target);
  if (format === "uuid") result.format = format;
  else if (format !== undefined)
    issue("unsupported-format", target, `Unsupported semantic format ${JSON.stringify(format)}`);
}

/**
 * Pattern restriction that must be a valid Unicode ECMAScript expression
 * @param program - Fully checked compiler program
 * @param target - Declaration or property owning the restriction
 * @param issue - Source-addressed failure accumulator
 * @param result - Restrictions receiving the pattern
 */
function readPattern(
  program: Program,
  target: Type,
  issue: IssueSink,
  result: MutableConstraints,
): void {
  const pattern = getPattern(program, target);
  if (pattern === undefined) return;
  try {
    new RegExp(pattern, "u");
    result.pattern = pattern;
  } catch {
    issue(
      "invalid-pattern",
      target,
      "The pattern is not a valid Unicode ECMAScript regular expression",
    );
  }
}

/**
 * Rejection of bounds declared through scalar values rather than numbers
 * @param program - Fully checked compiler program
 * @param target - Declaration or property owning the restrictions
 * @param issue - Source-addressed failure accumulator
 */
function rejectScalarBounds(program: Program, target: Type, issue: IssueSink): void {
  if (
    getMinValueForScalar(program, target) ||
    getMaxValueForScalar(program, target) ||
    getMinValueExclusiveForScalar(program, target) ||
    getMaxValueExclusiveForScalar(program, target)
  )
    issue(
      "unsupported-scalar-bound",
      target,
      "Non-numeric scalar bounds cannot be represented by the selected contract profile",
    );
}

/**
 * Exact bound provenance retained by compiler decorator argument nodes
 * @param target - Resolved declaration owning the constraint
 * @param decorator - Registered built-in numeric constraint
 * @param resolved - Compiler-resolved value for nonliteral argument expressions
 * @param exactNumber - Compiler syntax provenance for numeric decorator arguments
 * @returns Exact source numeric value without binary64 literal interning
 */
function exactNumericConstraint(
  target: Type,
  decorator: string,
  resolved: Numeric | undefined,
  exactNumber: ExactNumber,
): Numeric | undefined {
  if (!resolved) return undefined;
  const application =
    "decorators" in target
      ? target.decorators.find(
          (application) =>
            application.definition?.name === decorator &&
            getNamespaceFullName(application.definition.namespace) === "TypeSpec",
        )
      : undefined;
  return Numeric(
    exactNumber(application?.args[0]?.node, resolved.toString(), application?.node ?? target),
  );
}
