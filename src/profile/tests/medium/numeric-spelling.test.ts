import { expect, test } from "vite-plus/test";
import { codesFrom, modelFrom, objectFrom, scalarFrom } from "./profile-source.fixture.js";

test("numeric references sharing a compiler literal cache entry fail instead of selecting one spelling", async () => {
  const codes = await codesFrom(`namespace Public;
    const first: int64 = 9007199254740992;
    const second: int64 = 9007199254740993;
    model Input { @providerDefault(second) value?: int64; }`);
  expect(codes).toContain("ambiguous-numeric-reference");
});

test("nearby source numerals never collapse through compiler binary64 literal caching", async () => {
  const model = await modelFrom(`namespace Public;
    @minValue(9007199254740992) @maxValue(9007199254740993) scalar ExactRange extends integer;
    model Numbers { first: 9007199254740992; second: 9007199254740993; @providerDefault(9007199254740993) supplied?: ExactRange; }
    union Cases { first: 9007199254740992, second: 9007199254740993 }`);
  expect(scalarFrom(model, "ExactRange").constraints).toEqual({
    minimum: { value: "9007199254740992", exclusive: false },
    maximum: { value: "9007199254740993", exclusive: false },
  });
  const numbers = objectFrom(model, "Numbers");
  const field = (name: string) => numbers.fields.find((candidate) => candidate.name === name);
  const literalOf = (name: string) => model.types.find((type) => type.id === field(name)?.type.id);
  expect(literalOf("first")).toMatchObject({
    kind: "literal",
    value: { kind: "number", text: "9007199254740992" },
  });
  expect(literalOf("second")).toMatchObject({
    kind: "literal",
    value: { kind: "number", text: "9007199254740993" },
  });
  expect(field("supplied")?.default).toEqual({ kind: "number", text: "9007199254740993" });
});

test("a literal union keeps both exact member values", async () => {
  const model = await modelFrom(`namespace Public;
    union Cases { first: 9007199254740992, second: 9007199254740993 }`);
  const cases = model.types.find((type) => type.name === "Cases");
  if (cases?.kind !== "enum") throw new Error("Missing exact literal union");
  expect(cases.members.map((member) => member.value)).toEqual([
    { kind: "number", text: "9007199254740992" },
    { kind: "number", text: "9007199254740993" },
  ]);
});

test.each(["9007199254740992 | 9007199254740993", "9007199254740993 | 9007199254740992"])(
  "an anonymous numeric literal union %s keeps both exact values in canonical order",
  async (values) => {
    const model = await modelFrom(`namespace Public; model Input { value: ${values}; }`);
    const use = objectFrom(model, "Input").fields[0]!.type;
    const enumeration = model.types.find((type) => type.id === use.id);
    if (enumeration?.kind !== "enum") throw new Error("Missing exact anonymous union");
    expect(enumeration.members.map((member) => member.value)).toEqual([
      { kind: "number", text: "9007199254740992" },
      { kind: "number", text: "9007199254740993" },
    ]);
  },
);

test("compiler intrinsic indexers and numeric ancestor metadata support ordinary typed arrays", async () => {
  const model = await modelFrom(`namespace Public;
    model Values { single: float32; double: float64; values: int32[]; }
    const exact: decimal = 1.2300;
    model Input { @providerDefault(exact) amount?: decimal; }`);
  expect(objectFrom(model, "Values").fields.map((field) => field.name)).toEqual([
    "double",
    "single",
    "values",
  ]);
  expect(objectFrom(model, "Input").fields[0]?.default).toEqual({
    kind: "number",
    text: "1.2300",
  });
});
