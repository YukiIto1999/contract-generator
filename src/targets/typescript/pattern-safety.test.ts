import { expect, test } from "vite-plus/test";
import type { Result } from "ts-results-es";
import type { ContractModel, Constraints } from "../../model/contract-model.js";
import { loadGenerated } from "./load-generated.js";
import { member, objectType, scalarType } from "./model-builders.js";

/** Rejection observations at the generated boundary */
interface Rejection {
  readonly violations: readonly { readonly path: string; readonly rule: string }[];
  readonly diagnostics: readonly { readonly path: string; readonly key: string }[];
}

/** Located validation result with retained unknown-member observations */
type Outcome = Result<
  { readonly value: unknown; readonly diagnostics: Rejection["diagnostics"] },
  Rejection
>;

/** Public generated codec entrypoints used by the finite adversarial corpus */
interface Codec {
  create(value: unknown): Outcome;
  decode(text: string): Outcome;
  fromWire(value: unknown): Outcome;
}

/** Admitted fixed patterns with explicit matching and failing witnesses */
const patterns = [
  { name: "Nested", pattern: "^(a+)+$", yes: "a".repeat(16384), no: "a".repeat(16384) + "!" },
  {
    name: "Overlapping",
    pattern: "^(a|aa)+$",
    yes: "a".repeat(16384),
    no: "a".repeat(16384) + "!",
  },
  { name: "Nullable", pattern: "^(a*)*b$", yes: "a".repeat(16384) + "b", no: "a".repeat(16384) },
  { name: "Unanchored", pattern: "a+a+$", yes: "baaa", no: "a".repeat(16384) + "!" },
] as const;

/** Real generated module without a hostile native RegExp oracle */
const contract = loadGenerated({
  namespace: "T",
  name: "T",
  operations: [],
  types: patterns.map(({ name, pattern }) =>
    scalarType(name, "string", { constraints: { pattern } }),
  ),
}).contract;

/**
 * Finite exercise of every public synchronous acceptance path
 * @param codec - Generated codec
 * @param input - Candidate independent of production translation
 * @returns Result from every seam without execution timing assertions
 */
function outcomes(codec: Codec, input: unknown): readonly Outcome[] {
  return [codec.create(input), codec.decode(JSON.stringify(input)), codec.fromWire(input)];
}

for (const entry of patterns) {
  test(`safe engine evaluates ${entry.name} through create decode and fromWire`, () => {
    const codec = contract[entry.name] as Codec;
    for (const result of outcomes(codec, entry.yes)) expect(result.isOk()).toBe(true);
    for (const result of outcomes(codec, entry.no)) {
      expect(result.isErr()).toBe(true);
      if (result.isErr())
        expect(result.error).toEqual({
          violations: [{ path: "", rule: "format" }],
          diagnostics: [],
        });
    }
  });
}

test.each([30, 1024, 16384, 65536])(
  "nested repetition on %i characters has explicit outcomes",
  (length) => {
    const codec = contract.Nested as Codec;
    for (const result of outcomes(codec, "a".repeat(length))) expect(result.isOk()).toBe(true);
    for (const result of outcomes(codec, "a".repeat(length) + "!")) {
      expect(result.isErr()).toBe(true);
      if (result.isErr())
        expect(result.error).toEqual({
          violations: [{ path: "", rule: "format" }],
          diagnostics: [],
        });
    }
  },
);

test.each([
  { maximum: 8, rule: "maxLength" },
  { maximum: 31, rule: "format" },
])("length guard %j is local to the candidate", ({ maximum, rule }) => {
  const model: ContractModel = {
    namespace: "T",
    name: "T",
    operations: [],
    types: [
      scalarType("Text", "string", { constraints: { pattern: "^(a+)+$", maxLength: maximum } }),
    ],
  };
  const codec = loadGenerated(model).contract.Text as Codec;
  for (const result of outcomes(codec, "a".repeat(30) + "!")) {
    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error).toEqual({ violations: [{ path: "", rule }], diagnostics: [] });
  }
});

/** Same-value cheap failures that must not suppress a sibling's pattern */
const cheapCases: readonly { constraints: Constraints; input: unknown; rule: string }[] = [
  { constraints: { maxLength: 8 }, input: "a".repeat(30) + "!", rule: "maxLength" },
  { constraints: { minLength: 3 }, input: "!", rule: "minLength" },
  { constraints: { format: "uuid" }, input: "!", rule: "format" },
  { constraints: {}, input: 42, rule: "type" },
];

test.each(cheapCases)(
  "continues sibling pattern validation after $rule",
  ({ constraints, input, rule }) => {
    const first = scalarType("First", "string", {
      constraints: { pattern: "^(a+)+$", ...constraints },
    });
    const second = scalarType("Second", "string", { constraints: { pattern: "^b+$" } });
    const object = objectType("Pair", [member("first", first), member("second", second)]);
    const codec = loadGenerated({
      namespace: "T",
      name: "T",
      types: [first, second, object],
      operations: [],
    }).contract.Pair as Codec;
    for (const result of outcomes(codec, { first: input, second: "!", future: true })) {
      expect(result.isErr()).toBe(true);
      if (result.isErr())
        expect(result.error).toEqual({
          violations: [
            { path: "/first", rule },
            { path: "/second", rule: "format" },
          ],
          diagnostics: [{ path: "", key: "future" }],
        });
    }
  },
);

test("rejected replacement neither mutates the accepted value nor changes unknown-member algebra", () => {
  const text = scalarType("Text", "string", { constraints: { pattern: "^(a+)+$" } });
  const object = objectType("Item", [member("value", text)]);
  const codec = loadGenerated({ namespace: "T", name: "T", types: [text, object], operations: [] })
    .contract.Item as Codec;
  const accepted = codec.create({ value: "a", future: true }).unwrap();
  expect(accepted.diagnostics).toEqual([{ path: "", key: "future" }]);
  expect(Object.isFrozen(accepted.value)).toBe(true);
  for (const result of outcomes(codec, { value: "a".repeat(16384) + "!", future: true })) {
    expect(result.isErr()).toBe(true);
    if (result.isErr())
      expect(result.error).toEqual({
        violations: [{ path: "/value", rule: "format" }],
        diagnostics: [{ path: "", key: "future" }],
      });
  }
  expect(accepted.value).toEqual({ value: "a" });
});
