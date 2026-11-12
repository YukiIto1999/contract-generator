import { expect, test } from "vite-plus/test";
import { codesFrom, modelFrom, objectFrom, scalarFrom } from "./profile-source.fixture.js";

test("an exclusive boundary is a bound that excludes its own value", async () => {
  const model = await modelFrom(`namespace Public;
    @minValueExclusive(1) @maxValue(5) scalar Range extends int32;`);
  expect(scalarFrom(model, "Range").constraints).toEqual({
    minimum: { value: "1", exclusive: true },
    maximum: { value: "5", exclusive: false },
  });
});

test("an inclusive and an exclusive declaration for one side keep the stricter spelling", async () => {
  const model = await modelFrom(`namespace Public;
    @minValue(5) @minValueExclusive(3) scalar Looser extends int32;
    @minValueExclusive(5) @minValue(2) scalar Stricter extends int32;
    @maxValue(7) @maxValueExclusive(9) scalar Upper extends int32;`);
  expect(scalarFrom(model, "Looser").constraints.minimum).toEqual({ value: "5", exclusive: false });
  expect(scalarFrom(model, "Stricter").constraints.minimum).toEqual({
    value: "5",
    exclusive: true,
  });
  expect(scalarFrom(model, "Upper").constraints.maximum).toEqual({ value: "7", exclusive: false });
});

test("an inherited exclusive boundary stays exclusive when a derived scalar repeats its value", async () => {
  const model = await modelFrom(`namespace Public;
    @minValueExclusive(0) scalar Positive extends int32;
    @minValue(0) @maxValue(10) scalar Bounded extends Positive;
    @minValue(2) scalar Tighter extends Positive;`);
  expect(scalarFrom(model, "Bounded").constraints).toEqual({
    minimum: { value: "0", exclusive: true },
    maximum: { value: "10", exclusive: false },
  });
  expect(scalarFrom(model, "Tighter").constraints.minimum).toEqual({
    value: "2",
    exclusive: false,
  });
});

test("intrinsic integer widths contribute inclusive bounds", async () => {
  const model = await modelFrom("namespace Public; scalar Small extends int32;");
  expect(scalarFrom(model, "Small").constraints).toEqual({
    minimum: { value: "-2147483648", exclusive: false },
    maximum: { value: "2147483647", exclusive: false },
  });
});

test("use-site bounds are recorded as written beside the scalar's own bounds", async () => {
  const model = await modelFrom(`namespace Public;
    @minValue(0) @maxValue(100) scalar Percent extends int32;
    model Gauge { @maxValueExclusive(50) low: Percent; @maxValue(80) high: Percent; }`);
  const gauge = objectFrom(model, "Gauge");
  const constraints = (name: string) =>
    gauge.fields.find((field) => field.name === name)?.type.constraints;
  expect(constraints("low")).toEqual({ maximum: { value: "50", exclusive: true } });
  expect(constraints("high")).toEqual({ maximum: { value: "80", exclusive: false } });
});

test.each([
  ["an exclusive minimum equal to an inclusive maximum", "@minValueExclusive(3) @maxValue(3)"],
  ["two exclusive boundaries around no integer", "@minValueExclusive(1) @maxValueExclusive(2)"],
])("%s has an empty domain", async (_name, decorators) => {
  const codes = await codesFrom(`namespace Public; ${decorators} scalar Empty extends int32;`);
  expect(codes).toContain("empty-domain");
});

test("a provider default on an exclusive boundary is invalid and the next value is valid", async () => {
  const source = (value: number) => `namespace Public;
    @minValueExclusive(0) scalar Positive extends int32;
    model Input { @providerDefault(${value}) amount?: Positive; }`;
  expect(await codesFrom(source(0))).toContain("invalid-default");
  const model = await modelFrom(source(1));
  expect(objectFrom(model, "Input").fields[0]?.default).toEqual({ kind: "number", text: "1" });
});
