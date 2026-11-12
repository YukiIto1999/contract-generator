/** Canonical value of a JSON number spelling */
interface DecimalParts {
  /** Negative nonzero value */
  readonly negative: boolean;
  /** Significant digits without leading or trailing zeros, or `0` for zero */
  readonly digits: string;
  /** Power of ten scaling the digits */
  readonly exponent: bigint;
}

/** Largest power of ten expanded into an integer, bounding generator memory */
const maxIntegerExponent = 400n;

/** Exact decimal decomposition without binary floating-point conversion
 * @param text - JSON number spelling
 * @returns Canonical parts, or undefined when the text is not a JSON number
 */
function decimalParts(text: string): DecimalParts | undefined {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (match === null) return undefined;
  const [, sign, whole = "", fraction = "", exponent = "0"] = match;
  const all = `${whole}${fraction}`.replace(/^0+/, "");
  if (all === "") return { negative: false, digits: "0", exponent: 0n };
  const digits = all.replace(/0+$/, "");
  const scale = BigInt(exponent) - BigInt(fraction.length) + BigInt(all.length - digits.length);
  return { negative: sign === "-", digits, exponent: scale };
}

/** Numeric equality of two spellings independent of scale
 * @param left - First JSON number spelling
 * @param right - Second JSON number spelling
 * @returns Whether both spellings denote the same value
 */
export function sameNumber(left: string, right: string): boolean {
  const a = decimalParts(left);
  const b = decimalParts(right);
  return (
    a !== undefined &&
    b !== undefined &&
    a.negative === b.negative &&
    a.digits === b.digits &&
    a.exponent === b.exponent
  );
}

/** Integer value of a spelling that denotes an integer
 * @param text - JSON number spelling
 * @returns The exact integer, or undefined for a fraction, a non-number or an unbounded magnitude
 */
export function exactInteger(text: string): bigint | undefined {
  const parts = decimalParts(text);
  if (parts === undefined || parts.exponent < 0n || parts.exponent > maxIntegerExponent)
    return undefined;
  const magnitude = BigInt(parts.digits) * 10n ** parts.exponent;
  return parts.negative ? -magnitude : magnitude;
}

/** Strict JSON number grammar
 * @param text - Candidate spelling
 * @returns Whether the text is a complete JSON number token
 */
export function jsonNumber(text: string): boolean {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text);
}
