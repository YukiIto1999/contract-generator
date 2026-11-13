import { expect, test } from "vite-plus/test";
import {
  codesFrom,
  issuesFrom,
  modelFrom,
  objectFrom,
  scalarFrom,
} from "./profile-source.fixture.js";

/** Declarations whose provider defaults carry exact numerals and lexical date-times */
const exactDefaults = (timestamp: string, leapSecond: string) => `namespace Public;
  @minValue(-900719925474099312345) @maxValue(900719925474099312345) scalar Large extends integer;
  @preserveLexical scalar Moment extends offsetDateTime;
  model Base { required: string | null; }
  model Detail extends Base { @encodedName("application/json", "wire-name") label: string; }
  model Defaults {
    @providerDefault(900719925474099312344) large?: Large;
    @providerDefault(12345678901234567890.12345678901234567890) exact?: decimal;
    @providerDefault(Moment.fromISO("${timestamp}")) moment?: Moment;
    @providerDefault(Moment.fromISO("${leapSecond}")) leap?: Moment;
    @providerDefault(#{ required: null, label: "x" }) detail?: Detail;
  }`;

test("inherited constraints keep exact bounds and provider defaults keep exact tokens and offsets", async () => {
  const timestamp = "0000-02-29T12:34:56.123456789012345678+05:45";
  const leapSecond = "1991-01-01T05:44:60.5+05:45";
  const model = await modelFrom(exactDefaults(timestamp, leapSecond));
  expect(scalarFrom(model, "Large").constraints).toEqual({
    minimum: { value: "-900719925474099312345", exclusive: false },
    maximum: { value: "900719925474099312345", exclusive: false },
  });
  const defaults = objectFrom(model, "Defaults");
  const value = (name: string) => defaults.fields.find((field) => field.name === name)?.default;
  expect(value("large")).toEqual({ kind: "number", text: "900719925474099312344" });
  expect(value("exact")).toEqual({
    kind: "number",
    text: "12345678901234567890.12345678901234567890",
  });
  expect(value("moment")).toEqual({ kind: "string", value: timestamp });
  expect(value("leap")).toEqual({ kind: "string", value: leapSecond });
});

test("a composite default is keyed by wire names and keeps explicit null", async () => {
  const model = await modelFrom(
    exactDefaults("2000-01-01T00:00:00Z", "1991-01-01T05:44:60.5+05:45"),
  );
  const detail = objectFrom(model, "Defaults").fields.find((field) => field.name === "detail");
  expect(detail?.default).toEqual({
    kind: "object",
    properties: { required: { kind: "null" }, "wire-name": { kind: "string", value: "x" } },
  });
});

test("a leap second outside the final UTC minute of June or December is an invalid provider default", async () => {
  const { issues } = await issuesFrom(
    'namespace Public; model Input { @providerDefault(offsetDateTime.fromISO("0000-02-29T23:59:60+05:45")) at?: offsetDateTime; }',
  );
  expect(issues.some((issue) => issue.code === "invalid-default")).toBe(true);
});

test("provider defaults count Unicode code points rather than UTF-16 units", async () => {
  const source = (value: string) =>
    `namespace Public; @minLength(1) @maxLength(3) scalar ShortLabel extends string; model Input { @providerDefault("${value}") text?: ShortLabel; }`;
  const model = await modelFrom(source("😀😀😀"));
  expect(objectFrom(model, "Input").fields[0]?.default).toEqual({
    kind: "string",
    value: "😀😀😀",
  });
  expect(await codesFrom(source("😀😀😀😀"))).toContain("invalid-default");
});

test("built-in property defaults and required provider defaults are rejected", async () => {
  expect(await codesFrom("namespace Public; model Input { limit?: int32 = 3; }")).toContain(
    "unsupported-default-syntax",
  );
  expect(
    await codesFrom("namespace Public; model Input { @providerDefault(3) limit: int32; }"),
  ).toContain("required-provider-default");
});

test("an inherited pattern rejects a default that violates it", async () => {
  const codes = await codesFrom(
    'namespace Public; @pattern("^[a-z]+$") scalar Lower extends string; model Input { @providerDefault("UPPER") value?: Lower; }',
  );
  expect(codes).toContain("invalid-default");
});

test("a recursive default expansion is rejected", async () => {
  const codes = await codesFrom(
    "namespace Public; model Tree { @providerDefault(#{}) child?: Tree; }",
  );
  expect(codes).toContain("nonterminating-default");
});

test("a finite recursive default is accepted", async () => {
  const model = await modelFrom(
    "namespace Public; model Tree { @providerDefault(null) child?: Tree | null; } model Root { @providerDefault(#{}) tree?: Tree; }",
  );
  expect(objectFrom(model, "Root").fields[0]?.default).toEqual({ kind: "object", properties: {} });
});

test("a default at any depth is validated against its own field", async () => {
  const codes = await codesFrom(`namespace Public;
    model Inner { @providerDefault("nope") count?: int32; }
    model Outer { inner: Inner; items: Inner[]; }`);
  expect(codes).toContain("invalid-default");
});
