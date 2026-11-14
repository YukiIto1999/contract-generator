/** Exact numeric token extraction, integrality, float finiteness and boundary checks */
export const runtimeNumbersSource = String.raw`/** Exact JSON number grammar */
const numberToken = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Numeric accepted representation selecting the local primitive: exact text, safe integer number, bigint or any finite float */
type NumericNative = "text" | "safe" | "bigint" | "float";

/** Exact numeric boundary with its own inclusion rule */
interface NumericBound {
  /** Exact boundary value */
  readonly value: LosslessNumber;
  /** Exclusion of the boundary value itself */
  readonly exclusive: boolean;
}

/** Numeric lower and upper boundaries */
interface NumericRange {
  /** Lower boundary */
  readonly minimum?: NumericBound;
  /** Upper boundary */
  readonly maximum?: NumericBound;
}

/**
 * Exact text of a string spelled as a JSON number
 * @param value - Candidate
 * @returns The text when it follows the JSON number grammar, otherwise absence
 */
function stringNumberText(value: unknown): string | undefined {
  return typeof value === "string" && numberToken.test(value) ? value : undefined;
}

/**
 * Text of a finite JavaScript number
 * @param value - Candidate
 * @param anyWhole - Acceptance of whole numbers beyond the safe integer range
 * @returns Decimal text or absence
 */
function finiteNumberText(value: unknown, anyWhole: boolean): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return anyWhole || !Number.isInteger(value) || Number.isSafeInteger(value) ? String(value) : undefined;
}

/**
 * Exact token of a parsed JSON number
 * @param value - Parsed JSON value
 * @returns Exact token of a lossless number or a finite exact JavaScript number, otherwise absence
 */
function jsonNumberText(value: unknown): string | undefined {
  return isLosslessNumber(value) ? value.value : finiteNumberText(value, false);
}

/**
 * Exact numeric token of one candidate under construction or decoding rules
 * @param value - Candidate
 * @param mode - Candidate origin
 * @param selected - Selected binding encoding
 * @param native - Primitive accepted by construction
 * @returns Valid exact token or absence
 */
function numericText(value: unknown, mode: Mode, selected: string, native: NumericNative): string | undefined {
  if (mode === "local") {
    switch (native) {
      case "text": return stringNumberText(value);
      case "bigint": return typeof value === "bigint" ? value.toString() : undefined;
      case "float": return finiteNumberText(value, true);
      case "safe": return finiteNumberText(value, false);
    }
  }
  if (selected === "string") return stringNumberText(value);
  return native === "float" && !isLosslessNumber(value) ? finiteNumberText(value, true) : jsonNumberText(value);
}

/**
 * Numeric literal candidate
 * @param value - Candidate
 * @param mode - Candidate origin
 * @returns Exact numeric value or absence
 */
function literalNumber(value: unknown, mode: Mode): LosslessNumber | undefined {
  const text = mode !== "local" ? jsonNumberText(value) : typeof value === "number" ? finiteNumberText(value, false) : stringNumberText(value);
  return text === undefined ? undefined : new LosslessNumber(text);
}

/**
 * Integral numeric value recognition without exponent expansion
 * @param text - Valid JSON numeric token
 * @returns Integer membership
 */
function isIntegral(text: string): boolean {
  const match = /^-?(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text)!;
  const digits = match[1]! + (match[2] ?? "");
  if (/^0+$/.test(digits)) return true;
  const shift = BigInt((match[3] ?? "0").replace("+", "")) - BigInt((match[2] ?? "").length);
  if (shift >= 0n) return true;
  if (-shift > BigInt(digits.length)) return false;
  return /^0*$/.test(digits.slice(digits.length - Number(-shift)));
}

/**
 * Exact integer conversion after integral recognition
 * @param text - Valid integral JSON numeric token
 * @returns Exact bigint value
 */
function integerValue(text: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text)!;
  const digits = match[2]! + (match[3] ?? "");
  if (/^0+$/.test(digits)) return 0n;
  const shift = BigInt((match[4] ?? "0").replace("+", "")) - BigInt((match[3] ?? "").length);
  if (shift < 0n) return BigInt(match[1]! + digits.slice(0, digits.length - Number(-shift)));
  return BigInt(match[1]! + digits) * 10n ** shift;
}

/**
 * Binary floating point range of a numeric token
 * @param text - Valid JSON numeric token
 * @param bits - Floating point width
 * @returns Whether the rounded value is finite
 */
function isFiniteFloat(text: string, bits: 32 | 64): boolean {
  const rounded = Number(text);
  return Number.isFinite(bits === 32 ? Math.fround(rounded) : rounded);
}

/**
 * Exact boundary creation
 * @param value - Exact decimal spelling of the boundary
 * @param exclusive - Exclusion of the boundary value itself
 * @returns Frozen boundary
 */
function bound(value: string, exclusive: boolean): NumericBound {
  return Object.freeze({ value: new LosslessNumber(value), exclusive });
}

/**
 * Exact range check without binary64 conversion
 * @param state - Current call
 * @param path - Candidate location
 * @param text - Valid JSON numeric token
 * @param range - Declared boundaries
 */
function checkRange(state: State, path: Path, text: string, range: NumericRange): void {
  const candidate = new LosslessNumber(text);
  if (range.minimum !== undefined) {
    const order = compareLosslessNumber(candidate, range.minimum.value);
    if (order < 0 || (order === 0 && range.minimum.exclusive)) invalid(state, path, "minimum");
  }
  if (range.maximum !== undefined) {
    const order = compareLosslessNumber(candidate, range.maximum.value);
    if (order > 0 || (order === 0 && range.maximum.exclusive)) invalid(state, path, "maximum");
  }
}

/**
 * Numeric binding representation
 * @param value - Completed number, bigint or exact text
 * @param selected - Selected binding encoding
 * @returns Text for the string encoding, otherwise an exact JSON number
 */
function writeNumber(value: number | bigint | string, selected: string): unknown {
  return selected === "string" ? String(value) : new LosslessNumber(String(value));
}
`;
