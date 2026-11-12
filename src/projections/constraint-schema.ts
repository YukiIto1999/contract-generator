import { LosslessNumber } from "lossless-json";
import type { Constraints } from "../model/contract-model.js";
import type { JsonObject } from "./reference-document.js";

/** Numeric boundary keywords keeping each inclusion rule
 * @param constraints - Interpreted restrictions
 * @param numeric - Numeric JSON representation rather than a numeric string
 * @returns Lower and upper boundary keywords in schema order without a binary64 conversion
 */
function boundKeywords(constraints: Constraints, numeric: boolean): JsonObject {
  const edges = [
    { bound: constraints.minimum, inclusive: "minimum", exclusive: "exclusiveMinimum" },
    { bound: constraints.maximum, inclusive: "maximum", exclusive: "exclusiveMaximum" },
  ] as const;
  const keywords: JsonObject = {};
  for (const { bound, inclusive, exclusive } of edges) {
    if (bound === undefined) continue;
    keywords[bound.exclusive ? exclusive : inclusive] = numeric
      ? new LosslessNumber(bound.value)
      : bound.value;
  }
  return keywords;
}

/** Constraints representable as reference annotations or schema keywords
 * @param constraints - Interpreted restrictions
 * @param numeric - Numeric JSON representation rather than a numeric string
 * @returns Constraint projection without coercing exact bounds
 */
export function constraintSchema(constraints: Constraints, numeric: boolean): JsonObject {
  const result: JsonObject = {};
  if (constraints.minLength !== undefined) result.minLength = constraints.minLength;
  if (constraints.maxLength !== undefined) result.maxLength = constraints.maxLength;
  if (constraints.minItems !== undefined) result.minItems = constraints.minItems;
  if (constraints.maxItems !== undefined) result.maxItems = constraints.maxItems;
  if (constraints.pattern !== undefined) result.pattern = constraints.pattern;
  if (constraints.format !== undefined) result.format = constraints.format;
  const bounds = boundKeywords(constraints, numeric);
  if (numeric) Object.assign(result, bounds);
  else if (Object.keys(bounds).length > 0) result["x-contract-numeric-bounds"] = bounds;
  return result;
}
