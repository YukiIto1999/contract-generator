import { expect, test } from "vite-plus/test";
import type { Result } from "ts-results-es";
import type { ContractModel } from "../../model/contract-model.js";
import { loadGenerated } from "./load-generated.js";
import { scalarType } from "./model-builders.js";

/** Explicit expected membership independent of the production translator */
interface Case {
  /** Authored ECMAScript Unicode source */
  readonly pattern: string;
  /** Strings in the declared language */
  readonly yes: readonly string[];
  /** Strings outside the declared language */
  readonly no: readonly string[];
}

/** Finite semantic oracle with no native regular expression execution */
const cases: readonly Case[] = [
  { pattern: "a", yes: ["ba!"], no: ["", "b"] },
  { pattern: "^a$", yes: ["a"], no: ["a\n", "a\r", "a\u2028", "a\u2029", "ba"] },
  { pattern: "^.$", yes: ["\u{1f600}", "\u0085"], no: ["\n", "\r", "\u2028", "\u2029", ""] },
  { pattern: "^\u{1f600}$", yes: ["\u{1f600}"], no: ["x"] },
  { pattern: "^\\u{1F600}$", yes: ["\u{1f600}"], no: ["x"] },
  { pattern: "^\\uD83D\\uDE00$", yes: ["\u{1f600}"], no: ["x"] },
  { pattern: "^é$", yes: ["é"], no: ["e\u0301"] },
  { pattern: "^\\d+$", yes: ["123"], no: ["١", "a"] },
  { pattern: "^[\\d]+$", yes: ["123"], no: ["١", "a"] },
  { pattern: "^[\\D]$", yes: ["a"], no: ["7"] },
  { pattern: "^\\w+$", yes: ["Az_09"], no: ["é", "K"] },
  { pattern: "^\\W$", yes: ["é", "K"], no: ["a"] },
  {
    pattern: "^\\s$",
    yes: [
      "\u0009",
      "\u000a",
      "\u000b",
      "\u000c",
      "\u000d",
      "\u0020",
      "\u00a0",
      "\u1680",
      "\u2000",
      "\u2001",
      "\u2002",
      "\u2003",
      "\u2004",
      "\u2005",
      "\u2006",
      "\u2007",
      "\u2008",
      "\u2009",
      "\u200a",
      "\u2028",
      "\u2029",
      "\u202f",
      "\u205f",
      "\u3000",
      "\ufeff",
    ],
    no: ["\u0085", "\u180e", "a"],
  },
  { pattern: "^[\\S]$", yes: ["\u0085", "\u180e", "a"], no: ["\u000b", "\ufeff"] },
  { pattern: "^[a&&b]$", yes: ["a", "&", "b"], no: ["c"] },
  { pattern: "^a\\.b$", yes: ["a.b"], no: ["axb"] },
  { pattern: "^(ab|cd){2,3}?$", yes: ["abcd", "abcdab"], no: ["ab", "abcdabcd"] },
  { pattern: "", yes: ["", "x"], no: [] },
  { pattern: "[]", yes: [], no: ["", "x", "\n"] },
  { pattern: "[^]", yes: ["\n", "\u{1f600}"], no: [""] },
  { pattern: "(?:|a)", yes: ["", "x", "a"], no: [] },
  { pattern: "(?<part>a+)", yes: ["ba", "aa"], no: ["b"] },
  { pattern: "^a{01}$", yes: ["a"], no: ["aa", ""] },
  { pattern: "^[^a\\D]$", yes: ["7"], no: ["a", "x"] },
  { pattern: "^[\\D7]$", yes: ["a", "7", "é"], no: ["6"] },
  { pattern: "^[\\d\\D]$", yes: ["a", "7", "\n", "\u{1f600}"], no: [""] },
  { pattern: "^[a-cx-z]$", yes: ["a", "b", "c", "x", "z"], no: ["w", "d"] },
  { pattern: "^[\\b]$", yes: ["\b"], no: ["b", ""] },
  { pattern: "^[]*$", yes: [""], no: ["x"] },
  { pattern: "^[]+$", yes: [], no: ["", "x"] },
  { pattern: "^(?:a|)$", yes: ["", "a"], no: ["b"] },
  { pattern: "^a{0}$", yes: [""], no: ["a"] },
  { pattern: "^[\\uD83D\\uDE00]$", yes: ["\u{1f600}"], no: ["x"] },
];

/** Acceptance result of a generated scalar codec */
type Outcome = Result<
  { readonly value: unknown },
  readonly { readonly path: string; readonly rule: string }[]
>;

/** Public synchronous codec seams */
interface Codec {
  create(value: unknown): Outcome;
  decode(text: string): Outcome;
  fromWire(value: unknown): Outcome;
}

/** One generated module containing every independent corpus pattern */
const model: ContractModel = {
  namespace: "T",
  name: "T",
  operations: [],
  types: cases.map((entry, index) =>
    scalarType(`Pattern${index}`, "string", {
      constraints: { pattern: entry.pattern },
    }),
  ),
};

/** Real generated codecs with eagerly loaded external dependencies */
const contract = loadGenerated(model).contract;

/**
 * All synchronous public string acceptance paths
 * @param codec - Generated scalar codec
 * @param value - Original string without normalization
 * @returns Construction and decoding outcomes
 */
function outcomes(codec: Codec, value: string): readonly Outcome[] {
  return [codec.create(value), codec.decode(JSON.stringify(value)), codec.fromWire(value)];
}

for (const [index, entry] of cases.entries()) {
  test(`preserves Unicode membership for ${JSON.stringify(entry.pattern)}`, () => {
    const codec = contract[`Pattern${index}`] as Codec;
    for (const value of entry.yes)
      for (const result of outcomes(codec, value)) {
        expect(result.isOk(), JSON.stringify(value)).toBe(true);
        if (result.isOk()) expect(result.value.value).toBe(value);
      }
    for (const value of entry.no)
      for (const result of outcomes(codec, value)) {
        expect(result.isErr(), JSON.stringify(value)).toBe(true);
        if (result.isErr()) expect(result.error).toEqual([{ path: "", rule: "format" }]);
      }
  });
}

test("reuses the same private matcher without lastIndex state", () => {
  const codec = contract.Pattern22 as Codec;
  for (const [value, accepted] of [
    ["a", true],
    ["!", false],
    ["a", true],
  ] as const)
    expect(codec.create(value).isOk()).toBe(accepted);
});

test("codepoint length does not normalize or split supplementary characters", () => {
  const codec = loadGenerated({
    namespace: "T",
    name: "T",
    operations: [],
    types: [
      scalarType("One", "string", { constraints: { pattern: "^.$", minLength: 1, maxLength: 1 } }),
    ],
  }).contract.One as Codec;
  for (const result of outcomes(codec, "\u{1f600}")) expect(result.isOk()).toBe(true);
  for (const result of outcomes(codec, "e\u0301")) {
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error).toEqual([{ path: "", rule: "maxLength" }]);
  }
});
