import { expect, test } from "vite-plus/test";
import type { Result } from "ts-results-es";
import type { ContractModel } from "../../model/contract-model.js";
import { semanticCases as cases } from "../../model/patterns/semantic-vectors.fixture.js";
import { loadGenerated } from "./load-generated.js";
import { scalarType } from "./model-builders.js";

/** Rejection observations at the generated boundary */
interface Rejection {
  readonly violations: readonly { readonly path: string; readonly rule: string }[];
  readonly diagnostics: readonly { readonly path: string; readonly key: string }[];
}

/** Acceptance result of a generated scalar codec */
type Outcome = Result<
  { readonly value: unknown; readonly diagnostics: Rejection["diagnostics"] },
  Rejection
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
        if (result.isErr())
          expect(result.error).toEqual({
            violations: [{ path: "", rule: "format" }],
            diagnostics: [],
          });
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
    if (result.isErr())
      expect(result.error).toEqual({
        violations: [{ path: "", rule: "maxLength" }],
        diagnostics: [],
      });
  }
});

test("an unpaired surrogate is rejected before any pattern reads it, as in the other generated languages", () => {
  const codec = contract[`Pattern${cases.findIndex(({ pattern }) => pattern === "a")}`] as Codec;
  for (const value of ["a\ud83d", "\ude00a", "\ud83d\ud83da"]) {
    for (const result of [
      codec.create(value),
      codec.fromWire(value),
      codec.decode(JSON.stringify(value)),
    ])
      expect(result.isErr(), JSON.stringify(value)).toBe(true);
    for (const result of [codec.create(value), codec.fromWire(value)])
      if (result.isErr())
        expect(result.error).toEqual({
          violations: [{ path: "", rule: "format" }],
          diagnostics: [],
        });
  }
  expect(codec.create("a\u{1f600}").isOk()).toBe(true);
});
