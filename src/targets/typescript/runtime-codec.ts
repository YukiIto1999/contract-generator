/** Private read boundary and codec construction shared by every declaration */
export const runtimeCodecSource = String.raw`/**
 * Plain JSON object acceptance
 * @param value - Parsed JSON value
 * @returns The object or a shape violation
 */
export function jsonObject(value: unknown): Result<Record<string, unknown>, readonly Violation[]> {
  return objectValue(value) ? Ok(value) : Err(shapeViolations);
}

/**
 * Boundary rejection without member observations
 * @param violations - Syntax or shape failures
 * @returns Immutable complete rejection
 */
function rejection(violations: readonly Violation[]): BoundaryRejection {
  return Object.freeze({ violations, diagnostics: Object.freeze([]) });
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
function accept<T>(input: unknown, mode: Mode, defaults: boolean, reader: Reader<T>): Result<Accepted<T>, BoundaryRejection> {
  if (input === undefined) return Err(rejection(absentViolations));
  const state: State = { defaults, violations: [], diagnostics: [], active: new WeakSet() };
  const value = finishRead(reader(input, undefined, state, mode));
  if (state.violations.length > 0) return Err(Object.freeze({
    violations: Object.freeze(state.violations),
    diagnostics: Object.freeze(state.diagnostics),
  }));
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
    accept(value, "local", false, reader).mapErr((error) => error.violations).map((accepted) => wireGraph(writer(accepted.value, binding)));
  return Object.freeze({
    create: (input: unknown) => accept(input, "local", false, reader),
    fromWire: (input: unknown, binding: WireBinding = "http") => accept(input, binding, false, reader),
    decode: (text: string, binding: WireBinding = "http") => parseJson(text).mapErr(rejection).andThen((input) => accept(input, binding, false, reader)),
    toWire,
    encode: (value: T, binding: WireBinding = "http") => accept(value, "local", false, reader)
      .mapErr((error) => error.violations)
      .map((accepted) => wireText(writer(accepted.value, binding))),
  });
}

/**
 * Acceptance of the absent payload of a result without a value
 * @param input - Candidate payload
 * @returns Absent payload or a shape violation
 */
function acceptNoValue(input: unknown): Result<Accepted<undefined>, BoundaryRejection> {
  if (input !== undefined) return Err(rejection(shapeViolations));
  return Ok(Object.freeze({ value: undefined, diagnostics: Object.freeze([]) }));
}

/** Codec of a result without a payload: only the absent value is accepted and it has no JSON document */
export const noValue: Codec<undefined> = Object.freeze({
  create: acceptNoValue,
  decode: (text: string) => parseJson(text).mapErr(rejection).andThen(acceptNoValue),
  fromWire: acceptNoValue,
  encode: () => Err(shapeViolations),
  toWire: (value: undefined) => acceptNoValue(value).mapErr((error) => error.violations).map(() => undefined),
});
`;
