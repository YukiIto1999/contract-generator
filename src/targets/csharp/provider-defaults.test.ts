import { expect, test } from "vite-plus/test";
import { CSharpContext } from "./context.js";
import { acceptanceNodes } from "./provider-default-plan.js";
import {
  arrayOf,
  field,
  modelOf,
  objectOf,
  operationOf,
  options,
  scalarOf,
  unionOf,
  use,
} from "./test-models.js";

/** Contract whose only default sits on an optional member of a leaf object below the first operation input */
const context = new CSharpContext(
  modelOf(
    [
      scalarOf("Text", "string"),
      objectOf("Leaf", [
        field("kind", use("Text")),
        field("note", use("Text"), { optional: true, default: { kind: "string", value: "x" } }),
      ]),
      objectOf("Holder", [field("leaf", use("Leaf"))]),
      arrayOf("Leaves", use("Leaf")),
      objectOf("Choice", [field("kind", use("Text"))]),
      unionOf("Shape", [
        ["leaf", "Leaf"],
        ["choice", "Choice"],
      ]),
      objectOf("DeepInput", [field("holder", use("Holder"))]),
      objectOf("ArrayInput", [field("items", use("Leaves"))]),
      objectOf("UnionInput", [field("shape", use("Shape"))]),
      objectOf("PlainInput", [field("choice", use("Choice"))]),
    ],
    [
      operationOf("deep", "DeepInput"),
      operationOf("array", "ArrayInput"),
      operationOf("union", "UnionInput"),
      operationOf("plain", "PlainInput"),
    ],
  ),
  options.csharpNamespace,
);

test("a default below a nested object reaches the operation input", () => {
  const needs = acceptanceNodes(context);
  expect(["Leaf", "Holder", "DeepInput"].filter((id) => !needs.has(id))).toEqual([]);
});

test("a default below an array element object reaches the operation input", () => {
  const needs = acceptanceNodes(context);
  expect(["Leaves", "ArrayInput"].filter((id) => !needs.has(id))).toEqual([]);
});

test("a default below a union variant reaches the operation input", () => {
  const needs = acceptanceNodes(context);
  expect(["Shape", "UnionInput"].filter((id) => !needs.has(id))).toEqual([]);
});

test("an input without a default anywhere below it is not rebuilt", () => {
  const needs = acceptanceNodes(context);
  expect([needs.has("PlainInput"), needs.has("Choice")]).toEqual([false, false]);
});
