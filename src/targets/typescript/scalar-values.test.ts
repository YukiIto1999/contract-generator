import { expect, test } from "vite-plus/test";
import type { Result } from "ts-results-es";
import type { ContractModel } from "../../model/contract-model.js";
import { loadGenerated, type LoadedModule } from "./load-generated.js";
import { scalarType } from "./model-builders.js";

/** Violation list or accepted value of a generated codec call */
type Outcome = Result<
  { readonly value: unknown },
  readonly { readonly path: string; readonly rule: string }[]
>;

/** Public entrypoints of a generated scalar codec */
interface ScalarCodec {
  create(input: unknown): Outcome;
  decode(text: string): Outcome;
  encode(value: unknown): Result<string, unknown>;
}

/** Contract with one scalar declaration per tested meaning */
const model: ContractModel = {
  namespace: "T",
  name: "T",
  types: [
    scalarType("Instant", "utcDateTime"),
    scalarType("Offset", "offsetDateTime"),
    scalarType("Span", "duration"),
    scalarType("Real", "float64"),
    scalarType("Single", "float32"),
    scalarType("Small", "int32"),
  ],
  operations: [],
};

/** Executed generated contract shared by every test of this file */
let contract: LoadedModule | undefined;

/**
 * Generated codec of a declaration
 * @param name - Declaration name
 * @returns Executed codec
 */
function codec(name: string): ScalarCodec {
  contract ??= loadGenerated(model).contract;
  return contract[name] as ScalarCodec;
}

/**
 * Violations of a rejected call
 * @param outcome - Codec result
 * @returns Located violations, empty for an accepted value
 */
function violations(outcome: Outcome): readonly { readonly path: string; readonly rule: string }[] {
  return outcome.isErr() ? outcome.error : [];
}

test("utcDateTime accepts the zero offset spellings in construction and decoding", () => {
  for (const text of [
    "2024-05-06T07:08:09Z",
    "2024-05-06T07:08:09z",
    "2024-05-06T07:08:09+00:00",
    "2024-05-06T07:08:09-00:00",
  ]) {
    expect(codec("Instant").create(text).isOk(), text).toBe(true);
    expect(codec("Instant").decode(JSON.stringify(text)).isOk(), text).toBe(true);
  }
});

test("utcDateTime rejects every non-zero offset as a format violation in construction and decoding", () => {
  for (const text of [
    "2024-05-06T07:08:09+05:45",
    "2024-05-06T07:08:09-01:00",
    "2024-05-06T07:08:09+00:01",
  ]) {
    expect(violations(codec("Instant").create(text)), text).toEqual([{ path: "", rule: "format" }]);
    expect(violations(codec("Instant").decode(JSON.stringify(text))), text).toEqual([
      { path: "", rule: "format" },
    ]);
  }
});

test("offsetDateTime keeps any offset", () => {
  expect(codec("Offset").create("2024-05-06T07:08:09+05:45").isOk()).toBe(true);
  expect(codec("Offset").decode('"2024-05-06T07:08:09-01:00"').isOk()).toBe(true);
});

test("duration accepts the week form alone and the date-time form", () => {
  for (const text of ["P2W", "P0W", "P1Y2M3DT4H5M6S", "PT36H", "-PT1.5S"]) {
    expect(codec("Span").create(text).isOk(), text).toBe(true);
    expect(codec("Span").decode(JSON.stringify(text)).isOk(), text).toBe(true);
  }
});

test("duration rejects a week mixed with other designators, an unsigned-week sign and empty forms", () => {
  for (const text of ["P1Y2W", "P2W1D", "-P2W", "P", "PT", "P2WT1H"]) {
    expect(violations(codec("Span").create(text)), text).toEqual([{ path: "", rule: "format" }]);
  }
});

test("float64 construction accepts whole numbers beyond the safe integer range exactly as decoding does", () => {
  const created = codec("Real").create(1e300);
  const decoded = codec("Real").decode("1e300");
  expect(created.isOk()).toBe(true);
  expect(decoded.isOk()).toBe(true);
  if (created.isErr() || decoded.isErr()) return;
  expect(created.value.value).toBe(1e300);
  expect(decoded.value.value).toBe(1e300);
});

test("float64 values beyond the safe integer range re-encode and round-trip", () => {
  const created = codec("Real").create(1e300);
  if (created.isErr()) throw new Error("1e300 must be accepted");
  const encoded = codec("Real").encode(created.value.value);
  expect(encoded.isOk()).toBe(true);
  if (encoded.isErr()) return;
  const decoded = codec("Real").decode(encoded.value);
  expect(decoded.isOk()).toBe(true);
  expect(decoded.isOk() && decoded.value.value).toBe(1e300);
  expect(
    codec("Real")
      .create(2 ** 60)
      .isOk(),
  ).toBe(true);
});

test("float32 and int32 reject out-of-range numbers identically in construction and decoding", () => {
  expect(violations(codec("Single").create(1e300))).toEqual([{ path: "", rule: "maximum" }]);
  expect(violations(codec("Single").decode("1e300"))).toEqual([{ path: "", rule: "maximum" }]);
  expect(violations(codec("Small").create(2 ** 31))).toEqual([{ path: "", rule: "maximum" }]);
  expect(violations(codec("Small").decode("2147483648"))).toEqual([{ path: "", rule: "maximum" }]);
});
