import type { Constant, ScalarType } from "../model/contract-model.js";
import { compareNumbers, isIntegral } from "./numeric-bounds.js";
import { validDate, validDateTime, validDuration, validPlainTime } from "./temporal.js";

/**
 * Resolved scalar domain validation without lossy storage conversion
 * @param value - Exact candidate constant
 * @param type - Resolved scalar semantics
 * @returns Membership in the declared scalar domain
 */
export function validScalar(value: Constant, type: ScalarType): boolean {
  switch (type.scalar) {
    case "boolean":
      return value.kind === "boolean";
    case "string":
      return value.kind === "string";
    case "integer":
    case "int32":
    case "int64":
    case "uint64":
      return value.kind === "number" && isIntegral(value.text);
    case "decimal":
    case "float32":
    case "float64":
      return value.kind === "number";
    case "offsetDateTime":
      return value.kind === "string" && validDateTime(value.value, false);
    case "utcDateTime":
      return value.kind === "string" && validDateTime(value.value, true);
    case "plainDate":
      return value.kind === "string" && validDate(value.value);
    case "plainTime":
      return value.kind === "string" && validPlainTime(value.value);
    case "duration":
      return value.kind === "string" && validDuration(value.value);
    case "bytes":
      return value.kind === "array" && value.items.every(isByte);
  }
}

/**
 * Byte value test for one item of a bytes constant
 * @param item - Candidate array item
 * @returns Whether the item is an integer from 0 through 255
 */
function isByte(item: Constant): boolean {
  return (
    item.kind === "number" &&
    isIntegral(item.text) &&
    compareNumbers(item.text, "0") >= 0 &&
    compareNumbers(item.text, "255") <= 0
  );
}
