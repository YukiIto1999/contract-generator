import type { DiagnosticTarget } from "@typespec/compiler";
import type { Bound, Constraints } from "../model/contract-model.js";
import type { IssueSink } from "./issue-sink.js";
import { compareNumbers, type MutableConstraints } from "./numeric-bounds.js";

/** Cardinality restrictions combined by taking the stricter value */
const cardinalityKeys = ["minLength", "minItems", "maxLength", "maxItems"] as const;

/** Lower and upper cardinality pairs that must not cross */
const cardinalityPairs = [
  ["minLength", "maxLength"],
  ["minItems", "maxItems"],
] as const;

/**
 * Restriction intersection retaining stricter inherited boundaries
 * @param base - Previously resolved restrictions
 * @param own - Restrictions added by the derived declaration or use
 * @param target - Declaration responsible for the intersection
 * @param issue - Source-addressed failure accumulator
 * @returns Effective restrictions with empty domains diagnosed
 */
export function intersectConstraints(
  base: Constraints,
  own: Constraints,
  target: DiagnosticTarget,
  issue: IssueSink,
): Constraints {
  const result: MutableConstraints = { ...base };
  const minimum = stricterBound(base.minimum, own.minimum, true);
  if (minimum) result.minimum = minimum;
  const maximum = stricterBound(base.maximum, own.maximum, false);
  if (maximum) result.maximum = maximum;
  intersectCardinalities(base, own, result);
  if (own.format !== undefined) result.format = own.format;
  intersectPattern(base, own, result, target, issue);
  checkEmptyDomain(result, target, issue);
  return result;
}

/**
 * Stricter of two boundaries on the same side with exact comparison
 * @param base - Boundary inherited from the base declaration
 * @param own - Boundary added by the derived declaration or use
 * @param lower - Lower side rather than upper side
 * @returns The boundary admitting fewer values, excluding the value when either side excludes it
 */
function stricterBound(
  base: Bound | undefined,
  own: Bound | undefined,
  lower: boolean,
): Bound | undefined {
  if (base === undefined || own === undefined) return own ?? base;
  const comparison = lower
    ? compareNumbers(own.value, base.value)
    : compareNumbers(base.value, own.value);
  if (comparison > 0) return own;
  if (comparison < 0) return base;
  return { value: base.value, exclusive: base.exclusive || own.exclusive };
}

/**
 * Length and item-count intersection
 * @param base - Previously resolved restrictions
 * @param own - Restrictions added by the derived declaration or use
 * @param result - Restrictions receiving the intersected cardinalities
 */
function intersectCardinalities(
  base: Constraints,
  own: Constraints,
  result: MutableConstraints,
): void {
  for (const key of cardinalityKeys) {
    const value = own[key];
    if (value === undefined) continue;
    const previous = base[key];
    result[key] =
      previous === undefined
        ? value
        : key.startsWith("min")
          ? Math.max(previous, value)
          : Math.min(previous, value);
  }
}

/**
 * Pattern intersection allowed only for one repeated pattern
 * @param base - Previously resolved restrictions
 * @param own - Restrictions added by the derived declaration or use
 * @param result - Restrictions receiving the pattern
 * @param target - Declaration responsible for the intersection
 * @param issue - Source-addressed failure accumulator
 */
function intersectPattern(
  base: Constraints,
  own: Constraints,
  result: MutableConstraints,
  target: DiagnosticTarget,
  issue: IssueSink,
): void {
  if (own.pattern === undefined) return;
  if (base.pattern !== undefined && base.pattern !== own.pattern)
    issue(
      "unsupported-pattern-intersection",
      target,
      "Different inherited patterns require a conjunction that the contract model cannot represent without changing capture semantics",
    );
  else result.pattern = own.pattern;
}

/**
 * Empty numeric and cardinality domain detection
 * @param result - Effective restrictions after intersection
 * @param target - Declaration responsible for the intersection
 * @param issue - Source-addressed failure accumulator
 */
function checkEmptyDomain(result: Constraints, target: DiagnosticTarget, issue: IssueSink): void {
  const { minimum, maximum } = result;
  if (minimum !== undefined && maximum !== undefined) {
    const comparison = compareNumbers(minimum.value, maximum.value);
    if (comparison > 0 || (comparison === 0 && (minimum.exclusive || maximum.exclusive)))
      issue("empty-domain", target, "Numeric minimum and maximum admit no value");
  }
  for (const [min, max] of cardinalityPairs) {
    const lower = result[min];
    const upper = result[max];
    if (lower !== undefined && upper !== undefined && lower > upper)
      issue("empty-domain", target, `${min} exceeds ${max}`);
  }
}
