import { lines } from "./naming.js";

/** Result extraction for generated boundaries whose contract the caller already guaranteed
 * @param type - Result value type
 * @param expression - Result expression
 * @param variable - Completed variable
 * @returns Statements that bind `variable` or throw a defect
 */
export function requireValue(type: string, expression: string, variable: string): string {
  return lines(
    `var ${variable}Result = ${expression};`,
    `if (${variable}Result is not Result<${type}, ContractFailure>.Succeeded ${variable}Success) throw new InvalidOperationException("Contract invariant violated before wire output");`,
    `var ${variable} = ${variable}Success.Value;`,
  );
}
