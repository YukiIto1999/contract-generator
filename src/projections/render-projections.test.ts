import { isLosslessNumber, parse } from "lossless-json";
import { expect, test } from "vite-plus/test";
import type { GeneratedFile } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";
import {
  bytesId,
  childId,
  decimalMinimum,
  exactDecimalId,
  projectionSample,
  submitInputId,
  wideIntegerId,
  wideMaximum,
  wideMinimum,
} from "./projection-sample.fixture.js";
import { renderProjections } from "./render-projections.js";

/** Artifact paths of the JSON projections */
const jsonPaths = ["schemas/http.schema.json", "schemas/ipc.schema.json", "http/openapi.json"];
/** Artifact paths of the JSON Schema projections */
const schemaPaths = ["schemas/http.schema.json", "schemas/ipc.schema.json"];
/** Location of the HTTP schema definitions as referenced from the OpenAPI document */
const httpDefinitions = "../schemas/http.schema.json#/$defs/";
/** Schema of a body that is raw binary rather than a JSON string */
const rawBinary = { type: "string", format: "binary" };

/** Text of one rendered artifact
 * @param files - Rendered projections
 * @param path - Artifact path
 * @returns Artifact content
 * @throws {@link Error} The projection set has no artifact at the path
 */
function fileText(files: readonly GeneratedFile[], path: string): string {
  const file = files.find((candidate) => candidate.path === path);
  if (file === undefined) throw new Error("Missing projection artifact: " + path);
  return file.content;
}

/** Document of one JSON artifact parsed without binary64 numbers
 * @param files - Rendered projections
 * @param path - Artifact path
 * @returns Parsed document with numeric tokens as lossless numbers
 */
function document(files: readonly GeneratedFile[], path: string): unknown {
  return parse(fileText(files, path));
}

/** Own member membership of a parsed document part
 * @param value - Parsed document part
 * @param key - Member name
 * @returns Whether the part is an object with the member
 */
function has(value: unknown, key: string): boolean {
  return typeof value === "object" && value !== null && Object.hasOwn(value, key);
}

/** Member lookup that keeps numeric tokens exact
 * @param value - Parsed document or document part
 * @param path - Member names from the value downwards
 * @returns The addressed part
 * @throws {@link Error} A member on the path is absent
 */
function member(value: unknown, ...path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null || !has(current, key))
      throw new Error("Missing document member: " + path.join("/"));
    current = Reflect.get(current, key);
  }
  return current;
}

/** Exact spelling of a parsed number
 * @param value - Parsed numeric token
 * @returns Digits as written in the document
 * @throws {@link Error} The value is not a numeric token
 */
function digits(value: unknown): string {
  if (!isLosslessNumber(value)) throw new Error("Expected a numeric token");
  return value.value;
}

test("every projection is labelled reference-only and states what it omits", () => {
  const files = renderProjections(projectionSample());
  expect(files.map((file) => file.path).sort(compareText)).toEqual([
    "docs/reference.md",
    "http/openapi.json",
    "schemas/http.schema.json",
    "schemas/ipc.schema.json",
  ]);
  for (const path of jsonPaths) {
    const parsed = document(files, path);
    expect(member(parsed, "x-contract-generator-purpose")).toBe("reference-only");
    const limitations = member(parsed, "x-contract-limitations");
    expect(Array.isArray(limitations) && limitations.length > 0).toBe(true);
  }
  expect(fileText(files, "docs/reference.md")).toContain("Reference projection only");
});

test("exact numeric bounds beyond 2^53 keep every digit in numeric and string encodings", () => {
  expect(String(Number(wideMinimum))).not.toBe(wideMinimum);
  const files = renderProjections(projectionSample());
  for (const path of schemaPaths) {
    const definitions = member(document(files, path), "$defs");
    const wide = member(definitions, wideIntegerId);
    expect(member(wide, "type")).toBe("integer");
    expect(digits(member(wide, "minimum"))).toBe(wideMinimum);
    expect(digits(member(wide, "exclusiveMaximum"))).toBe(wideMaximum);
    expect(has(wide, "maximum")).toBe(false);
    const decimal = member(definitions, exactDecimalId);
    expect(member(decimal, "type")).toBe("string");
    expect(member(decimal, "x-contract-numeric-bounds", "exclusiveMinimum")).toBe(decimalMinimum);
    expect(has(decimal, "exclusiveMinimum")).toBe(false);
  }
});

test("provider defaults at every depth are annotated as provider-owned in the schemas", () => {
  const files = renderProjections(projectionSample());
  for (const path of schemaPaths) {
    const definitions = member(document(files, path), "$defs");
    const limit = member(definitions, submitInputId, "properties", "limit");
    expect(digits(member(limit, "default"))).toBe("3");
    expect(member(limit, "x-contract-default-owner")).toBe("provider-acceptance");
    const nested = member(definitions, childId, "properties", "retries");
    expect(digits(member(nested, "default"))).toBe("3");
    expect(member(nested, "x-contract-default-owner")).toBe("provider-acceptance");
    const amount = member(definitions, submitInputId, "properties", "amount");
    expect(has(amount, "default")).toBe(false);
    expect(has(amount, "x-contract-default-owner")).toBe(false);
  }
});

test("provider defaults in the OpenAPI request body are annotated as provider-owned", () => {
  const openApi = document(renderProjections(projectionSample()), "http/openapi.json");
  const requestContent = member(openApi, "paths", "/submit", "post", "requestBody", "content");
  const schema = member(requestContent, "application/json", "schema");
  const limit = member(schema, "properties", "limit");
  expect(digits(member(limit, "default"))).toBe("3");
  expect(member(limit, "x-contract-default-owner")).toBe("provider-acceptance");
  expect(has(member(schema, "properties", "amount"), "default")).toBe(false);
});

test("the reference document lists provider defaults in their own column", () => {
  const reference = fileText(renderProjections(projectionSample()), "docs/reference.md");
  const cells = (field: string): string[] =>
    reference
      .split("\n")
      .filter((line) => line.startsWith("|" + field + "|"))
      .flatMap((line) => line.split("|").slice(1, -1));
  expect(cells("limit")).toEqual(["limit", "Count", "optional", "3"]);
  expect(cells("amount")).toEqual(["amount", "WideInteger", "required", "—"]);
});

test("bytes under a non-JSON media type are raw binary in requests and responses", () => {
  const openApi = document(renderProjections(projectionSample()), "http/openapi.json");
  const request = member(openApi, "paths", "/upload", "post", "requestBody", "content");
  expect(request).toEqual({ "application/octet-stream": { schema: rawBinary } });
  const raw = member(openApi, "paths", "/fetch", "get", "responses", "200", "content");
  expect(raw).toEqual({ "application/octet-stream": { schema: rawBinary } });
});

test("bytes under a JSON media type are a string in the binding's bytes encoding", () => {
  const files = renderProjections(projectionSample());
  const openApi = document(files, "http/openapi.json");
  const described = member(openApi, "paths", "/fetch", "get", "responses", "201", "content");
  expect(described).toEqual({
    "application/vnd.sample+json": { schema: { $ref: httpDefinitions + bytesId } },
  });
  const bytes = member(document(files, "schemas/http.schema.json"), "$defs", bytesId);
  expect(member(bytes, "contentEncoding")).toBe("base64");
});

test("a bodyless result is projected without content", () => {
  const openApi = document(renderProjections(projectionSample()), "http/openapi.json");
  expect(has(member(openApi, "paths", "/upload", "post", "responses", "204"), "content")).toBe(
    false,
  );
});

test("a reference to an undeclared node is a defect, not a projection", () => {
  const sample = projectionSample();
  const broken = { ...sample, types: sample.types.filter((node) => node.id !== wideIntegerId) };
  expect(() => renderProjections(broken)).toThrow(wideIntegerId);
});
