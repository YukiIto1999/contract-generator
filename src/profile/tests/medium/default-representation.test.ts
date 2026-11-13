import { expect, test } from "vite-plus/test";
import { codesFrom, modelFrom, objectFrom } from "./profile-source.fixture.js";

/**
 * Model default of the single optional field `value` declared by a one-field input
 * @param declarations - Scalar or alias declarations the field refers to
 * @param type - Field type
 * @param value - Decorator argument source text
 * @returns Normalized default constant of the field
 */
async function defaultOf(declarations: string, type: string, value: string) {
  const model = await modelFrom(
    `namespace Public; ${declarations} model Input { @providerDefault(${value}) value?: ${type}; }`,
  );
  return objectFrom(model, "Input").fields[0]?.default;
}

/**
 * Rule codes reported for a one-field input whose default is rejected
 * @param declarations - Scalar or alias declarations the field refers to
 * @param type - Field type
 * @param value - Decorator argument source text
 * @returns Rule codes of the reported issues
 */
function rejectedBy(declarations: string, type: string, value: string) {
  return codesFrom(
    `namespace Public; ${declarations} model Input { @providerDefault(${value}) value?: ${type}; }`,
  );
}

test.each([
  ["an exponent", "1e3", "1000"],
  ["a redundant fraction", "5.0", "5"],
  ["a negative zero", "-0", "0"],
  ["an exponent and a fraction", "2.50e1", "25"],
])(
  "a whole-number default written with %s is stored as plain integer digits",
  async (_name, written, plain) => {
    expect(await defaultOf("", "int32", written)).toEqual({ kind: "number", text: plain });
    expect(await defaultOf("", "int64", written)).toEqual({ kind: "number", text: plain });
  },
);

test("a decimal default keeps the author's exact spelling", async () => {
  expect(await defaultOf("", "decimal", "1.2300")).toEqual({ kind: "number", text: "1.2300" });
});

test("a fractional default for a whole-number scalar is rejected", async () => {
  expect(await rejectedBy("", "int32", "1.5")).toContain("invalid-default");
});

test("a byte sequence default is an array of byte integers", async () => {
  expect(await defaultOf("", "bytes", "#[0, 16, 255]")).toEqual({
    kind: "array",
    items: [
      { kind: "number", text: "0" },
      { kind: "number", text: "16" },
      { kind: "number", text: "255" },
    ],
  });
  expect(await defaultOf("", "bytes", "#[1e1]")).toEqual({
    kind: "array",
    items: [{ kind: "number", text: "10" }],
  });
});

test.each(["#[256]", "#[-1]", "#[1.5]", '#["a"]', '"AAEC"'])(
  "the bytes default %s cannot be built and is rejected",
  async (value) => {
    expect(await rejectedBy("", "bytes", value)).toContain("invalid-default");
  },
);

test("a number or boolean default is the logical value even when a binding writes it as text", async () => {
  const declarations = `scalar Count extends int64; @@bindingEncoding(Count, "http", "string");
    scalar Flag extends boolean; @@bindingEncoding(Flag, "http", "string");
    @@bindingEncoding(Flag, "ipc", "string");`;
  expect(await defaultOf(declarations, "Count", "5")).toEqual({ kind: "number", text: "5" });
  expect(await defaultOf(declarations, "Flag", "true")).toEqual({ kind: "boolean", value: true });
  expect(await rejectedBy(declarations, "Count", '"5"')).toContain("invalid-default");
  expect(await rejectedBy(declarations, "Flag", '"true"')).toContain("invalid-default");
});

test("a binary default is the same byte array whichever encoding each binding selects", async () => {
  const declarations = `scalar Blob extends bytes;
    @@bindingEncoding(Blob, "http", "base64"); @@bindingEncoding(Blob, "ipc", "base64url");`;
  expect(await defaultOf(declarations, "Blob", "#[251, 255]")).toEqual({
    kind: "array",
    items: [
      { kind: "number", text: "251" },
      { kind: "number", text: "255" },
    ],
  });
});

test("a numeric literal or enumeration default carries the declared member spelling", async () => {
  const declarations = "union Level { one: 1, two: 2 }";
  expect(await defaultOf(declarations, "Level", "2.0")).toEqual({ kind: "number", text: "2" });
  expect(await rejectedBy(declarations, "Level", "3")).toContain("invalid-default");
});

test("integer defaults inside nested objects and arrays are normalized at every depth", async () => {
  const model = await modelFrom(`namespace Public;
    model Point { x: int32; y: int32; }
    model Input { @providerDefault(#[#{ x: 1e1, y: 2.0 }]) points?: Point[]; }`);
  expect(objectFrom(model, "Input").fields[0]?.default).toEqual({
    kind: "array",
    items: [
      {
        kind: "object",
        properties: { x: { kind: "number", text: "10" }, y: { kind: "number", text: "2" } },
      },
    ],
  });
});
