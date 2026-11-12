/** JSON syntax, private read boundary and codec construction shared by every declaration */
export const runtimeCodecSource = String.raw`/**
 * Error mapper for JSON syntax failures
 * @param cause - Caught value
 * @returns Syntax violations
 * @throws {@link Error} Value that is not a JSON syntax failure
 */
function jsonSyntaxViolations(cause: unknown): readonly Violation[] {
  if (cause instanceof SyntaxError) return syntaxViolations;
  throw cause;
}

/**
 * Error mapper for malformed UTF-8
 * @param cause - Caught value
 * @returns Syntax violations
 * @throws {@link Error} Value that is not a decoding failure
 */
function utf8Violations(cause: unknown): readonly Violation[] {
  if (cause instanceof TypeError) return syntaxViolations;
  throw cause;
}

/**
 * JSON syntax acceptance without custom parser
 * @param text - Complete JSON document
 * @returns Parser value or syntax violation
 */
export function parseJson(text: string): Result<unknown, readonly Violation[]> {
  return Result.wrap<unknown, unknown>(() => parse(text)).mapErr(jsonSyntaxViolations);
}

/**
 * JSON syntax acceptance for UTF-8 bytes
 * @param bytes - Complete JSON document encoding
 * @returns Parser value or syntax violation
 */
export function parseJsonBytes(bytes: Uint8Array): Result<unknown, readonly Violation[]> {
  return Result.wrap<string, unknown>(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    .mapErr(utf8Violations)
    .andThen(parseJson);
}

/**
 * Plain JSON object acceptance
 * @param value - Parsed JSON value
 * @returns The object or a shape violation
 */
export function jsonObject(value: unknown): Result<Record<string, unknown>, readonly Violation[]> {
  return objectValue(value) ? Ok(value) : Err(shapeViolations);
}

/**
 * Exact JSON document serialization
 * @param value - Completed binding representation
 * @returns Complete JSON document
 * @throws {@link ContractDefect} Representation without a JSON document
 */
export function stringifyJson(value: unknown): string {
  const text = stringify(value);
  if (text === undefined) throw new ContractDefect("Missing JSON value");
  return text;
}

/**
 * Private read boundary without partially accepted values
 * @typeParam T - Completed declaration
 * @param input - Candidate
 * @param mode - Origin interpretation
 * @param defaults - Provider default application to omitted members
 * @param reader - Specialized declaration reader
 * @returns Entire value and diagnostics or violations
 */
function accept<T>(input: unknown, mode: Mode, defaults: boolean, reader: Reader<T>): Result<Accepted<T>, readonly Violation[]> {
  if (input === undefined) return Err(absentViolations);
  const state: State = { defaults, violations: [], diagnostics: [], active: new WeakSet() };
  const value = reader(input, "", state, mode);
  if (state.violations.length > 0) return Err(Object.freeze(state.violations));
  return Ok(Object.freeze({ value: value as T, diagnostics: Object.freeze(state.diagnostics) }));
}

/**
 * Shared validated codec entrypoints
 * @typeParam T - Completed public value
 * @param reader - Specialized completion reader
 * @param writer - Specialized binding writer
 * @returns Frozen codec without provider defaults
 */
function codec<T>(reader: Reader<T>, writer: Writer<T>): Codec<T> {
  const toWire = (value: T, binding: WireBinding = "http"): Result<unknown, readonly Violation[]> =>
    accept(value, "local", false, reader).map((accepted) => writer(accepted.value, binding));
  return Object.freeze({
    create: (input: unknown) => accept(input, "local", false, reader),
    fromWire: (input: unknown, binding: WireBinding = "http") => accept(input, binding, false, reader),
    decode: (text: string, binding: WireBinding = "http") => parseJson(text).andThen((input) => accept(input, binding, false, reader)),
    toWire,
    encode: (value: T, binding: WireBinding = "http") => toWire(value, binding).map(stringifyJson),
  });
}

/**
 * Acceptance of the absent payload of a result without a value
 * @param input - Candidate payload
 * @returns Absent payload or a shape violation
 */
function acceptNoValue(input: unknown): Result<Accepted<undefined>, readonly Violation[]> {
  if (input !== undefined) return Err(shapeViolations);
  return Ok(Object.freeze({ value: undefined, diagnostics: Object.freeze([]) }));
}

/** Codec of a result without a payload: only the absent value is accepted and it has no JSON document */
export const noValue: Codec<undefined> = Object.freeze({
  create: acceptNoValue,
  decode: (text: string) => parseJson(text).andThen(acceptNoValue),
  fromWire: acceptNoValue,
  encode: () => Err(shapeViolations),
  toWire: (value: undefined) => acceptNoValue(value).map(() => undefined),
});
`;
