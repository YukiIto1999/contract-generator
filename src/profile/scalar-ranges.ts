import type { Bound, Constraints } from "../model/contract-model.js";
import { inclusive } from "./numeric-bounds.js";

/**
 * Closed numeric range from two inclusive decimal spellings
 * @param minimum - Smallest permitted value
 * @param maximum - Largest permitted value
 * @returns Restrictions holding exactly the two boundaries
 */
function range(minimum: string, maximum: string): { minimum: Bound; maximum: Bound } {
  return { minimum: inclusive(minimum), maximum: inclusive(maximum) };
}

/** Standard scalar range restrictions corresponding to TypeSpec intrinsic semantics */
export const intrinsicRanges: Readonly<Record<string, Constraints>> = {
  int8: range("-128", "127"),
  int16: range("-32768", "32767"),
  int32: range("-2147483648", "2147483647"),
  int64: range("-9223372036854775808", "9223372036854775807"),
  uint8: range("0", "255"),
  uint16: range("0", "65535"),
  uint32: range("0", "4294967295"),
  uint64: range("0", "18446744073709551615"),
  safeint: range("-9007199254740991", "9007199254740991"),
  float32: range(
    "-340000000000000000000000000000000000000",
    "340000000000000000000000000000000000000",
  ),
  float64: range("-1.7976931348623157e308", "1.7976931348623157e308"),
};
