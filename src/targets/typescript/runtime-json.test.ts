import { TokenizerError, TokenParserError } from "@streamparser/json";
import { LosslessNumber, isLosslessNumber } from "lossless-json";
import type { Result } from "ts-results-es";
import { expect, test, vi } from "vite-plus/test";
import { loadGenerated } from "./load-generated.js";
import { scalarType } from "./model-builders.js";

/** Generated public syntax and serialization entrypoints */
interface JsonBoundary {
  parseJson(
    text: string,
  ): Result<unknown, readonly { readonly path: string; readonly rule: string }[]>;
  parseJsonBytes(
    bytes: Uint8Array,
  ): Result<unknown, readonly { readonly path: string; readonly rule: string }[]>;
  stringifyJson(value: unknown): string;
  readonly ContractDefect: new (...args: never[]) => Error;
}

/** Shared real generated contract for public boundary tests */
let generated: JsonBoundary | undefined;

/**
 * Public JSON boundary from real generated modules
 * @returns Executed contract entrypoints
 */
function boundary(): JsonBoundary {
  generated ??= loadGenerated({
    namespace: "T",
    name: "T",
    types: [scalarType("Text", "string")],
    operations: [],
  }).contract as unknown as JsonBoundary;
  return generated;
}

/**
 * Complete accepted syntax value
 * @param text - JSON source
 * @returns Parsed representation
 */
function parsed(text: string): unknown {
  const result = boundary().parseJson(text);
  if (result.isErr()) throw new Error("Expected complete JSON acceptance");
  return result.value;
}

test.each(["array", "object", "alternating"])(
  "public JSON boundaries handle 20000-level %s documents",
  (kind) => {
    const opens: string[] = [];
    const closes: string[] = [];
    for (let depth = 0; depth < 20_000; depth++) {
      const array = kind === "array" || (kind === "alternating" && depth % 2 === 0);
      opens.push(array ? "[" : '{"v":');
      closes.push(array ? "]" : "}");
    }
    const text = opens.join("") + "1.2300e+400" + closes.reverse().join("");
    const value = parsed(text);
    expect(boundary().stringifyJson(value)).toBe(text);
    const bytes = boundary().parseJsonBytes(new TextEncoder().encode(text));
    expect(bytes.isOk()).toBe(true);
    if (bytes.isOk()) expect(boundary().stringifyJson(bytes.value)).toBe(text);
  },
);

test.each([
  "",
  " ",
  "[",
  "{",
  "[1,]",
  '{"a":1,}',
  '{"a":',
  "01",
  "-",
  "1.",
  "1e",
  "1e+",
  "true false",
  "{}[]",
  '"a""b"',
  '"a" 0',
  "null x",
  "[] trailing",
  "[0]]",
  "[true false]",
  '"unterminated',
  '"\\x00"',
  '"raw\nnewline"',
  '["valid", "unterminated',
])("public parser rejects the complete malformed document %j and resets", (text) => {
  const result = boundary().parseJson(text);
  expect(result.isErr()).toBe(true);
  if (result.isErr()) expect(result.error).toEqual([{ path: "", rule: "json" }]);
  expect(boundary().stringifyJson(parsed('{"ok":1}'))).toBe('{"ok":1}');
});

test("deep malformed tails never expose a completed prefix", () => {
  const valid = "[".repeat(20_000) + "0" + "]".repeat(20_000);
  for (const text of [valid + "x", valid + "0", valid.slice(0, -1), valid + "]"]) {
    expect(boundary().parseJson(text).isErr()).toBe(true);
    expect(boundary().parseJson("null").isOk()).toBe(true);
  }
});

test.each([
  '{"a":1,"a":1}',
  String.raw`{"a":1,"\u0061":2}`,
  '{"unknown":{"a":[],"a":{}}}',
  '{"unknown":[{"a":{"deep":1},"a":null}]}',
  '{"__proto__":0,"__proto__":1}',
  '{"constructor":0,"constructor":1}',
  String.raw`{"😀":0,"\ud83d\ude00":1}`,
  '{"\uFEFF":0,"":1,"\uFEFF":2}',
])("public parser rejects duplicate names throughout unknown subtrees %s", (text) => {
  expect(boundary().parseJson(text).isErr()).toBe(true);
  expect(boundary().parseJsonBytes(new TextEncoder().encode(text)).isErr()).toBe(true);
  expect(boundary().parseJson('{"a":1}').isOk()).toBe(true);
});

test("duplicate member scope belongs to each parent object", () => {
  const text = '{"left":{"a":1},"right":{"a":2},"__proto__":{"a":3}}';
  expect(boundary().stringifyJson(parsed(text))).toBe(text);
  const deep = '{"unknown":' + "[".repeat(20_000) + '{"x":0,"x":1}' + "]".repeat(20_000) + "}";
  expect(boundary().parseJson(deep).isErr()).toBe(true);
});

test("quoted source tokens preserve FEFF and UTF-8 offsets independently of tokenizer decoding", () => {
  const values = [
    "\uFEFF",
    "a\uFEFFb",
    "é\uFEFF😀",
    "\uFEFF\uFEFF",
    "😀",
    'a"b\\c',
    "\u0000",
    "\t\r\n",
  ];
  const text = JSON.stringify({ "\uFEFF": values, "é😀": "\uFEFF" });
  expect(boundary().stringifyJson(parsed(text))).toBe(text);
  const bytes = boundary().parseJsonBytes(new TextEncoder().encode(text));
  expect(bytes.isOk()).toBe(true);
  if (bytes.isOk()) expect(boundary().stringifyJson(bytes.value)).toBe(text);
  expect(parsed('"\uFEFF"  \n')).toBe("\uFEFF");
  expect(parsed(String.raw`"\uFEFF"`)).toBe("\uFEFF");
  expect(parsed(String.raw`"\ud83d\ude00"`)).toBe("😀");
  const distinct = '{"\uFEFF":1,"":2,"a\uFEFF":3,"a":4}';
  expect(boundary().stringifyJson(parsed(distinct))).toBe(distinct);
});

test.each([
  "\uFEFFnull",
  '"\ud800"',
  '"\udfff"',
  '{"\ud800":0}',
  String.raw`"\ud800"`,
  String.raw`"\udfff"`,
  String.raw`"\ud800x"`,
  String.raw`"\ud800\u0061"`,
  String.raw`{"\udfff":0}`,
])("public parser rejects BOM and ill-formed Unicode %j", (text) => {
  expect(boundary().parseJson(text).isErr()).toBe(true);
  expect(boundary().parseJson('"healthy"').isOk()).toBe(true);
});

test.each([
  [0xef, 0xbb, 0xbf, 0x30],
  [0x22, 0xc0, 0xaf, 0x22],
  [0x22, 0xed, 0xa0, 0x80, 0x22],
  [0x22, 0xf4, 0x90, 0x80, 0x80, 0x22],
  [0x22, 0xe2, 0x82],
])("public byte parser rejects malformed UTF-8 and leading BOM %j", (...bytes) => {
  expect(boundary().parseJsonBytes(Uint8Array.from(bytes)).isErr()).toBe(true);
  expect(boundary().parseJsonBytes(new TextEncoder().encode('"\uFEFF"')).isOk()).toBe(true);
});

test("all numeric tokens retain exact spelling at roots and nested members", () => {
  for (const token of ["-0", "0.000", "1.2300e+400", "1E-100000", "9007199254740993123456789"]) {
    const root = parsed(token);
    expect(isLosslessNumber(root)).toBe(true);
    expect(boundary().stringifyJson(root)).toBe(token);
    const text = '{"n":' + token + ',"list":[' + token + "]}";
    expect(boundary().stringifyJson(parsed(text))).toBe(text);
  }
});

test("direct serialization preserves own key order and every DAG occurrence", () => {
  const shared = { n: new LosslessNumber("1.00e+9") };
  const value = { z: shared, "2": shared, "1": [shared, shared], a: true };
  expect(boundary().stringifyJson(value)).toBe(
    '{"1":[{"n":1.00e+9},{"n":1.00e+9}],"2":{"n":1.00e+9},"z":{"n":1.00e+9},"a":true}',
  );
});

test("direct serialization rejects cycles without poisoning the next call", () => {
  const object: Record<string, unknown> = {};
  object.self = object;
  const array: unknown[] = [];
  array.push(array);
  for (const value of [object, array]) {
    expect(() => boundary().stringifyJson(value)).toThrow(boundary().ContractDefect);
    expect(boundary().stringifyJson({ ok: true })).toBe('{"ok":true}');
  }
});

test.each([
  undefined,
  () => 0,
  Symbol("x"),
  1n,
  NaN,
  Infinity,
  -Infinity,
  "\ud800",
  new Date(0),
  new Map(),
  new Uint8Array(1),
])("direct serialization rejects invalid representations %s without omission or null", (value) => {
  for (const input of [value, { value }, [value]]) {
    expect(() => boundary().stringifyJson(input)).toThrow(boundary().ContractDefect);
  }
  expect(boundary().stringifyJson(null)).toBe("null");
});

test("direct serialization rejects sparse arrays and malformed exact number representations", () => {
  const number = new LosslessNumber("1");
  number.value = "NaN";
  for (const value of [Array(2), { "\ud800": 1 }, number]) {
    expect(() => boundary().stringifyJson(value)).toThrow(boundary().ContractDefect);
  }
  for (const lexeme of ["1\n", "01", "1.", "1e", "Infinity"]) {
    number.value = lexeme;
    expect(() => boundary().stringifyJson(number)).toThrow(boundary().ContractDefect);
  }
});

test.each([
  new Error("callback"),
  new SyntaxError("callback"),
  new TypeError("callback"),
  new TokenizerError("callback"),
  new TokenParserError("callback"),
  { callback: true },
  undefined,
])("unexpected numeric completion callback exceptions preserve identity %s", (failure) => {
  const api = boundary();
  const defineProperty = Object.defineProperty;
  const spy = vi.spyOn(Object, "defineProperty").mockImplementation((target, key, attributes) => {
    if (key === "jsonFailure" && isLosslessNumber(attributes.value)) throw failure;
    return defineProperty(target, key, attributes);
  });
  let caught = false;
  try {
    api.parseJson('{"jsonFailure":1}');
  } catch (cause) {
    caught = true;
    expect(cause).toBe(failure);
  } finally {
    spy.mockRestore();
  }
  expect(caught).toBe(true);
  expect(api.parseJson('{"jsonFailure":1}').isOk()).toBe(true);
});
