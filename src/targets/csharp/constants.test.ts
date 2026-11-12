import { expect, test } from "vite-plus/test";
import type { Constant } from "../../model/contract-model.js";
import { wireConstant } from "./constants.js";
import { CSharpContext } from "./context.js";
import { field, modelOf, objectOf, options, scalarOf, use } from "./test-models.js";

/** Byte constant from plain integers
 * @param values - Byte values
 * @returns Array constant of number items
 */
function bytes(...values: readonly number[]): Constant {
  return { kind: "array", items: values.map((value) => ({ kind: "number", text: String(value) })) };
}

/** Context over scalars whose HTTP encodings differ from their IPC encodings */
const context = new CSharpContext(
  modelOf([
    { ...scalarOf("Blob", "bytes"), encodings: { http: "base64", ipc: "base64url" } },
    { ...scalarOf("Flag", "boolean"), encodings: { http: "string", ipc: "json" } },
    { ...scalarOf("Count", "int32"), encodings: { http: "string", ipc: "json" } },
    { ...scalarOf("Plain", "int32") },
    { ...scalarOf("Span", "duration") },
    objectOf("Leaf", [
      field("name", use("Span")),
      field("blob", use("Blob"), { optional: true }),
      field("count", use("Count"), { optional: true }),
    ]),
  ]),
  options.csharpNamespace,
);

test("bytes become the HTTP alphabet of the use, not the IPC alphabet or an integer array", () => {
  expect(wireConstant(context, use("Blob"), bytes(1, 2, 255))).toBe('"AQL/"');
  expect(wireConstant(context, use("Blob", { http: "base64url" }), bytes(1, 2, 255))).toBe(
    '"AQL_"',
  );
});

test("empty bytes become an empty string token", () => {
  expect(wireConstant(context, use("Blob"), bytes())).toBe('""');
});

test("a string-encoded boolean and number are JSON strings, a JSON-encoded number is bare", () => {
  expect(wireConstant(context, use("Flag"), { kind: "boolean", value: true })).toBe('"true"');
  expect(wireConstant(context, use("Flag"), { kind: "boolean", value: false })).toBe('"false"');
  expect(wireConstant(context, use("Count"), { kind: "number", text: "7" })).toBe('"7"');
  expect(wireConstant(context, use("Plain"), { kind: "number", text: "7" })).toBe("7");
  expect(
    wireConstant(context, use("Plain", { http: "string" }), { kind: "number", text: "7" }),
  ).toBe('"7"');
});

test("a duration and a date-time keep their declared lexical string", () => {
  expect(wireConstant(context, use("Span"), { kind: "string", value: "P2W" })).toBe('"P2W"');
});

test("an object constant is keyed by sorted wire names with each member in its own encoding", () => {
  const constant: Constant = {
    kind: "object",
    properties: {
      name: { kind: "string", value: "n" },
      count: { kind: "number", text: "3" },
      blob: bytes(0),
    },
  };
  expect(wireConstant(context, use("Leaf"), constant)).toBe(
    '{"blob":"AA==","count":"3","name":"n"}',
  );
});

test("null stays null for a nullable use", () => {
  expect(wireConstant(context, use("Blob"), { kind: "null" })).toBe("null");
});
