import { Numeric, type DiagnosticTarget } from "@typespec/compiler";
import type { Bound, Constraints } from "../model/contract-model.js";
import type { IssueSink } from "./issue-sink.js";

/** Writable view of the restrictions while one resolution step assembles them */
export type MutableConstraints = { -readonly [K in keyof Constraints]: Constraints[K] };

/**
 * Boundary that admits its own value
 * @param value - Exact decimal spelling of the boundary
 * @returns Inclusive bound
 */
export function inclusive(value: string): Bound {
  return { value, exclusive: false };
}

/**
 * Exact decimal comparison through the compiler numeric abstraction
 * @param left - Exact finite numeric spelling
 * @param right - Exact finite numeric spelling
 * @returns Negative or zero or positive ordering
 */
export function compareNumbers(left: string, right: string): number {
  const a = Numeric(left);
  const b = Numeric(right);
  return a.lt(b) ? -1 : a.gt(b) ? 1 : 0;
}

/**
 * Integral value test that does not depend on the spelling of the exponent or fraction
 * @param text - Exact finite numeric spelling
 * @returns Whether the value has no fractional part
 */
export function isIntegral(text: string): boolean {
  return !Numeric(text).toString().includes(".");
}

/**
 * Plain decimal spelling of an exact numeric value
 * @param text - Exact finite numeric spelling
 * @returns Spelling without exponent or redundant digits
 */
export function plainNumber(text: string): string {
  return Numeric(text).toString();
}

/**
 * Integer-domain satisfiability for exclusive and fractional boundaries
 * @param constraints - Effective integer restrictions
 * @param target - Declaration responsible for the domain
 * @param issue - Source-addressed failure accumulator
 */
export function checkIntegerDomain(
  constraints: Constraints,
  target: DiagnosticTarget,
  issue: IssueSink,
): void {
  const { minimum, maximum } = constraints;
  if (minimum === undefined || maximum === undefined) return;
  if (integerBoundary(minimum, true) > integerBoundary(maximum, false))
    issue("empty-domain", target, "Numeric restrictions admit no integer value");
}

/**
 * Integral inclusive boundary without binary floating-point conversion
 * @param bound - Declared exact boundary
 * @param lower - Lower boundary rather than upper boundary
 * @returns Smallest or largest permitted integer at the boundary
 */
function integerBoundary(bound: Bound, lower: boolean): bigint {
  const normalized = plainNumber(bound.value);
  const [whole = "0", fraction = ""] = normalized.split(".");
  const truncated = BigInt(whole);
  const fractional = /[1-9]/.test(fraction);
  const negative = normalized.startsWith("-");
  if (!fractional) return truncated + (bound.exclusive ? (lower ? 1n : -1n) : 0n);
  return truncated + (lower ? (negative ? 0n : 1n) : negative ? -1n : 0n);
}
