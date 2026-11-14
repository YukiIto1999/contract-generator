/** Stack-safe complete-document JSON boundaries emitted beside every contract */
export const runtimeJsonSource = String.raw`/** Tokenizer with exact numeric source spelling */
class JsonNumberTokenizer extends Tokenizer {
  /** Source spelling of the current numeric token */
  numberText = "";

  /**
   * Numeric token placeholder with separately retained source spelling
   * @param text - Complete JSON number token
   * @returns Finite numeric placeholder
   */
  protected override parseNumber(text: string): number {
    this.numberText = text;
    return 0;
  }
}

/**
 * Unicode scalar string discrimination
 * @param text - UTF-16 candidate
 * @returns Absence of unpaired surrogate code units
 */
function jsonUnicodeScalarString(text: string): boolean {
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

/**
 * Complete JSON syntax acceptance with exact numeric values
 * @param text - Complete JSON document
 * @returns Entire parser value or syntax violation
 * @throws {@link Error} Unexpected parser callback failure
 */
export function parseJson(text: string): Result<unknown, readonly Violation[]> {
  if (text.startsWith("\uFEFF") || !jsonUnicodeScalarString(text)) return Err(syntaxViolations);
  const syntaxFailure = {};
  const tokenizer = new JsonNumberTokenizer({ emitPartialTokens: false });
  const parser = new TokenParser({ keepStack: true, emitPartialValues: false });
  const members = new WeakMap<object, Set<string>>();
  let root: unknown;
  let roots = 0;
  let callbackFailed = false;
  let byteOffset = 0;
  let textOffset = 0;
  let pendingString: number | undefined;

  /**
   * Monotonic UTF-8 token offset conversion
   * @param offset - Token byte offset
   * @returns Corresponding UTF-16 source cursor
   */
  const sourceOffset = (offset: number): number => {
    while (byteOffset < offset) {
      const unit = text.charCodeAt(textOffset++);
      if (unit < 0x80) byteOffset++;
      else if (unit < 0x800) byteOffset += 2;
      else if (unit >= 0xd800 && unit <= 0xdbff) {
        byteOffset += 4;
        textOffset++;
      } else byteOffset += 3;
    }
    return textOffset;
  };

  /**
   * Completed quoted source token delivery
   * @param end - Next token cursor or document end
   * @throws {@link Error} Unexpected token callback failure
   */
  const finishString = (end: number): void => {
    if (pendingString === undefined) return;
    const pending = pendingString;
    pendingString = undefined;
    while (end > pending) {
      const unit = text.charCodeAt(end - 1);
      if (unit !== 0x20 && unit !== 0x09 && unit !== 0x0a && unit !== 0x0d) break;
      end--;
    }
    let value: unknown;
    try {
      value = JSON.parse(text.slice(pending, end));
    } catch (cause) {
      if (cause instanceof SyntaxError) throw syntaxFailure;
      callbackFailed = true;
      throw cause;
    }
    if (typeof value !== "string" || !jsonUnicodeScalarString(value)) throw syntaxFailure;
    parser.write({ token: TokenType.STRING, value });
  };

  parser.onValue = ({ value, parent, key, stack }): void => {
    try {
      if (parent !== undefined && typeof key === "string") {
        let names = members.get(parent);
        if (names === undefined) {
          names = new Set<string>();
          members.set(parent, names);
        }
        if (names.has(key)) throw syntaxFailure;
        names.add(key);
      }
      const exact: unknown = typeof value === "number" ? new LosslessNumber(tokenizer.numberText) : value;
      if (parent !== undefined && key !== undefined && typeof value === "number") {
        Object.defineProperty(parent, key, { value: exact, enumerable: true, configurable: true, writable: true });
      }
      if (stack.length === 0) {
        roots++;
        root = exact;
      }
    } catch (cause) {
      if (cause !== syntaxFailure) callbackFailed = true;
      throw cause;
    }
  };
  tokenizer.onToken = (token): void => {
    const start = sourceOffset(token.offset);
    finishString(start);
    if (token.token === TokenType.STRING) pendingString = start;
    else parser.write(token);
  };

  try {
    tokenizer.write(text);
    tokenizer.end();
    finishString(text.length);
    return roots === 1 && parser.isEnded ? Ok(root) : Err(syntaxViolations);
  } catch (cause) {
    if (!callbackFailed && (cause === syntaxFailure || cause instanceof TokenizerError || cause instanceof TokenParserError)) {
      return Err(syntaxViolations);
    }
    throw cause;
  }
}

/**
 * Complete UTF-8 JSON syntax acceptance
 * @param bytes - Complete JSON document encoding
 * @returns Entire parser value or syntax violation
 * @throws {@link Error} Unexpected decoding or parser callback failure
 */
export function parseJsonBytes(bytes: Uint8Array): Result<unknown, readonly Violation[]> {
  let text: string;
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  try {
    text = decoder.decode(bytes);
  } catch (cause) {
    if (cause instanceof TypeError) return Err(syntaxViolations);
    throw cause;
  }
  return parseJson(text);
}

/** One suspended container occurrence during direct JSON serialization */
type JsonWriteFrame = {
  /** Current container occurrence */
  readonly value: readonly unknown[] | Record<string, unknown>;
  /** Own member order for an object occurrence */
  readonly keys: readonly string[] | undefined;
  /** Next member index */
  next: number;
};

/**
 * Exact complete JSON serialization without recursive traversal
 * @param value - Completed binding representation
 * @returns Complete JSON document
 * @throws {@link ContractDefect} Invalid JSON representation or active ancestor cycle
 */
export function stringifyJson(value: unknown): string {
  const output: string[] = [];
  const frames: JsonWriteFrame[] = [];
  const active = new WeakSet<object>();
  let current = value;
  for (;;) {
    if (current === null || typeof current !== "object" || current instanceof LosslessNumber) {
      output.push(jsonScalarText(current));
    } else {
      const array = Array.isArray(current);
      const prototype: unknown = Object.getPrototypeOf(current);
      if (!array && prototype !== Object.prototype && prototype !== null) throw new ContractDefect("Invalid JSON object");
      if (active.has(current)) throw new ContractDefect("Cyclic JSON representation");
      active.add(current);
      const keys = array ? undefined : Object.keys(current);
      frames.push({ value: current as readonly unknown[] | Record<string, unknown>, keys, next: 0 });
      output.push(array ? "[" : "{");
    }

    let child = false;
    while (frames.length > 0) {
      const frame = frames[frames.length - 1]!;
      const length = frame.keys === undefined ? (frame.value as readonly unknown[]).length : frame.keys.length;
      if (frame.next === length) {
        output.push(frame.keys === undefined ? "]" : "}");
        active.delete(frame.value);
        frames.pop();
        continue;
      }
      if (frame.next > 0) output.push(",");
      const index = frame.next++;
      if (frame.keys === undefined) current = (frame.value as readonly unknown[])[index];
      else {
        const key = frame.keys[index]!;
        if (!jsonUnicodeScalarString(key)) throw new ContractDefect("Invalid JSON member name");
        output.push(JSON.stringify(key), ":");
        current = (frame.value as Record<string, unknown>)[key];
      }
      child = true;
      break;
    }
    if (!child) return output.join("");
  }
}

/**
 * Exact JSON scalar serialization without traversal allocation
 * @param value - Completed scalar representation
 * @returns Complete scalar token
 * @throws {@link ContractDefect} Invalid JSON scalar representation
 */
function jsonScalarText(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    if (!jsonUnicodeScalarString(value)) throw new ContractDefect("Invalid JSON string");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new ContractDefect("Invalid JSON number");
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (value instanceof LosslessNumber) {
    if (typeof value.value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?(?![\s\S])/.test(value.value)) {
      throw new ContractDefect("Invalid exact JSON number");
    }
    return value.value;
  }
  throw new ContractDefect("Invalid JSON scalar");
}
`;
