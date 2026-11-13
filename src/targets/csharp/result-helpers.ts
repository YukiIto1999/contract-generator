import { lines } from "./naming.js";

/** Result extraction for generated boundaries whose contract the caller already guaranteed
 * @param expression - Result expression
 * @param variable - Completed variable
 * @returns Statements that bind `variable` or throw a defect
 */
export function requireValue(expression: string, variable: string): string {
  return lines(
    `var ${variable}Result = ${expression};`,
    `if (${variable}Result.IsFailed(out _, out var ${variable})) throw new InvalidOperationException("Contract invariant violated before wire output");`,
  );
}
