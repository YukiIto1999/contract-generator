/** Provenance, ownership, member and encoding helpers shared by every specialized reader and writer */
export const runtimeValuesSource = String.raw`/** Reader-owned immutable declaration provenance */
const provenance = new WeakMap<object, Set<string>>();
/** Byte backing storage outside the public object graph */
const byteStorage = new WeakMap<object, Uint8Array>();
/** Violations of a value that is absent */
const absentViolations: readonly Violation[] = Object.freeze([Object.freeze({ path: "", rule: "undefined" })]);
/** Violations of a value with the wrong shape */
const shapeViolations: readonly Violation[] = Object.freeze([Object.freeze({ path: "", rule: "type" })]);
/** Violations of malformed JSON text */
const syntaxViolations: readonly Violation[] = Object.freeze([Object.freeze({ path: "", rule: "json" })]);

/**
 * JSON pointer extension
 * @param path - Containing location
 * @param key - Unescaped segment
 * @returns RFC 6901 location
 */
function pointer(path: string, key: string | number): string {
  return path + "/" + String(key).replace(/~/g, "~0").replace(/\//g, "~1");
}

/**
 * Rule accumulation
 * @param state - Current call
 * @param path - Violating location
 * @param rule - Semantic rule identity
 * @returns Invalid sentinel
 */
function invalid(state: State, path: string, rule: string): undefined {
  state.violations.push(Object.freeze({ path, rule }));
  return undefined;
}

/**
 * Plain object discrimination without unknown value traversal
 * @param value - Candidate
 * @returns Object shape discrimination
 */
function objectValue(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isLosslessNumber(value) &&
    !(value instanceof Uint8Array)
  );
}

/**
 * Object read entry rejecting wrong shapes and cycles
 * @param value - Candidate
 * @param path - Candidate location
 * @param state - Current call
 * @returns Whether the candidate is an object that may be read now
 */
function enterObject(value: unknown, path: string, state: State): value is Record<string, unknown> {
  if (!objectValue(value) || state.active.has(value)) {
    invalid(state, path, "type");
    return false;
  }
  state.active.add(value);
  return true;
}

/**
 * Array read entry rejecting wrong shapes and cycles
 * @param value - Candidate
 * @param path - Candidate location
 * @param state - Current call
 * @returns Whether the candidate is an array that may be read now
 */
function enterArray(value: unknown, path: string, state: State): value is readonly unknown[] {
  if (!Array.isArray(value) || state.active.has(value)) {
    invalid(state, path, "type");
    return false;
  }
  state.active.add(value);
  return true;
}

/**
 * Composite read exit
 * @param value - Composite candidate entered earlier
 * @param state - Current call
 * @param before - Violation count at entry
 * @returns Whether the composite read added no violation
 */
function leave(value: object, state: State, before: number): boolean {
  state.active.delete(value);
  return state.violations.length === before;
}

/**
 * Owned declaration completion
 * @typeParam T - Completed declaration
 * @param value - Newly owned value
 * @param id - Declaration identity
 * @returns Frozen value with private provenance
 */
function complete<T extends object>(value: T, id: string): T {
  Object.freeze(value);
  const identities = provenance.get(value) ?? new Set<string>();
  identities.add(id);
  if (id.endsWith(":effective")) identities.add(id.slice(0, -":effective".length));
  provenance.set(value, identities);
  return value;
}

/**
 * Known declaration observation
 * @param value - Local candidate
 * @param id - Declaration identity
 * @returns Private provenance match
 */
function known(value: unknown, id: string): boolean {
  return typeof value === "object" && value !== null && provenance.get(value)?.has(id) === true;
}

/**
 * Unknown member observation without retaining values
 * @param value - Object whose members were read
 * @param path - Object location
 * @param state - Current call
 * @param allowed - Declared member names of the read origin
 */
function reportUnknown(value: Record<string, unknown>, path: string, state: State, allowed: readonly string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) state.diagnostics.push(Object.freeze({ path, key }));
  }
}

/**
 * Unicode code point count independent of UTF-16 and UTF-8 length
 * @param text - Candidate text
 * @returns Number of code points with unpaired surrogates counted individually
 */
function codePointLength(text: string): number {
  let length = 0;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    const next = index + 1 < text.length ? text.charCodeAt(index + 1) : 0;
    if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) index++;
    length++;
  }
  return length;
}

/**
 * UUID text format
 * @param text - Candidate text
 * @returns Whether the text is a hyphenated hexadecimal UUID
 */
function isUuid(text: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(text);
}

/**
 * Scalar encoding selection
 * @param mode - Candidate origin
 * @param override - Use-site encoding
 * @param table - Declaration encodings by binding
 * @returns Selected encoding with the JSON default for local and constant values
 */
function selectEncoding(mode: Mode, override: string | undefined, table: EncodingTable): string {
  if (override !== undefined) return override;
  return mode === "local" || mode === "constant" ? "json" : (table[mode] ?? "json");
}

/**
 * Use-site encoding override of a binding
 * @param mode - Candidate origin
 * @param table - Use-site encodings by binding
 * @returns Override for wire origins, otherwise absence
 */
function pickEncoding(mode: Mode, table: EncodingTable): string | undefined {
  return mode === "local" || mode === "constant" ? undefined : table[mode];
}

/**
 * Immutable byte ownership without exposing backing storage
 * @param input - Source bytes
 * @param copy - Caller retention of the source bytes
 * @returns Frozen byte access object
 */
function ownBytes(input: Uint8Array, copy: boolean): ByteSequence {
  const bytes = copy ? Uint8Array.from(input) : input;
  const result: ByteSequence = Object.freeze({
    length: bytes.length,
    at: (index: number) => bytes[index],
    toUint8Array: () => Uint8Array.from(bytes),
  });
  byteStorage.set(result, bytes);
  return result;
}

/**
 * Profile byte constant conversion
 * @param value - Normalized constant array
 * @returns Owned bytes or absence
 */
function constantBytes(value: unknown): Uint8Array | undefined {
  if (!Array.isArray(value)) return undefined;
  const bytes = new Uint8Array(value.length);
  for (const [position, item] of value.entries()) {
    const token = jsonNumberText(item);
    if (token === undefined || !/^\d{1,3}$/.test(token) || Number(token) > 255) return undefined;
    bytes[position] = Number(token);
  }
  return bytes;
}

/**
 * Error mapper accepting only expected input failures
 * @param cause - Caught value
 * @returns The error of an expected input failure
 * @throws {@link Error} Value that is not an expected input failure
 */
function expectedInputError(cause: unknown): Error {
  if (cause instanceof Error) return cause;
  throw cause;
}

/**
 * Bytes acceptance for one selected representation
 * @param value - Candidate
 * @param path - Candidate location
 * @param state - Current call
 * @param mode - Candidate origin
 * @param selected - Selected binding encoding
 * @returns Owned bytes or the invalid sentinel
 */
function readBytes(value: unknown, path: string, state: State, mode: Mode, selected: string): ByteSequence | undefined {
  if (mode === "local" && typeof value === "object" && value !== null && byteStorage.has(value)) return value as ByteSequence;
  if (mode === "constant") {
    const owned = constantBytes(value);
    return owned === undefined ? invalid(state, path, "type") : ownBytes(owned, false);
  }
  if (value instanceof Uint8Array) return ownBytes(value, true);
  if (mode === "local" || typeof value !== "string") return invalid(state, path, "type");
  const decoded = Result.wrap<Uint8Array, unknown>(() => (selected === "base64url" ? base64url : base64).decode(value)).mapErr(expectedInputError);
  return decoded.isErr() ? invalid(state, path, "format") : ownBytes(decoded.value, false);
}

/**
 * Bytes binding representation
 * @param value - Completed byte access object
 * @param selected - Selected binding encoding
 * @returns Base64 or base64url text of the private byte storage
 */
function writeBytes(value: ByteSequence, selected: string): string {
  return (selected === "base64url" ? base64url : base64).encode(byteStorage.get(value)!);
}

/**
 * Boolean acceptance for one selected representation
 * @param value - Candidate
 * @param path - Candidate location
 * @param state - Current call
 * @param selected - Selected binding encoding
 * @returns Boolean or the invalid sentinel
 */
function readBoolean(value: unknown, path: string, state: State, selected: string): boolean | undefined {
  if (selected === "string") {
    if (value === "true") return true;
    return value === "false" ? false : invalid(state, path, "type");
  }
  return typeof value === "boolean" ? value : invalid(state, path, "type");
}
`;
