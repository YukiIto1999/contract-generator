import { expect, test } from "vite-plus/test";
import {
  field,
  modelOf,
  objectOf,
  operationOf,
  options,
  origin,
  scalarOf,
  use,
} from "./test-models.js";
import { renderCSharp } from "./render-csharp.js";

/** Two nominal roles over strings */
const roles = [
  scalarOf("RequestId", "string", "RequestId"),
  scalarOf("RecordId", "string", "RecordId"),
];

test("the same contract yields the same bytes for a reversed declaration enumeration", () => {
  const model = modelOf(roles);
  expect(renderCSharp(model, options).unwrap()).toEqual(
    renderCSharp({ ...model, types: [...model.types].reverse() }, options).unwrap(),
  );
});

test("an ECMAScript pattern is rejected at its declaration with the original position", () => {
  const pattern = { ...scalarOf("Pattern", "string"), constraints: { pattern: "(?<=a)b" } };
  const result = renderCSharp(modelOf([pattern]), options);
  expect(result.unwrapErr()[0]).toMatchObject({ target: "csharp", origin, subject: "Pattern" });
});

test("an encoding without an exact C# representation is rejected at the scalar", () => {
  const instant = {
    ...scalarOf("UnixInstant", "utcDateTime"),
    encodings: { http: "unixTimestamp", ipc: "rfc3339" },
  } as const;
  const issue = renderCSharp(modelOf([instant]), options).unwrapErr()[0]!;
  expect([issue.subject, issue.origin, issue.reason.includes("unixTimestamp")]).toEqual([
    "UnixInstant",
    origin,
    true,
  ]);
});

test("a contract type named like a generated operation family is a collision", () => {
  const collision = objectOf("ChooseSuccess", [field("value", use("Text"))]);
  const input = objectOf("ChooseInput", []);
  const result = renderCSharp(
    modelOf([scalarOf("Text", "string"), collision, input], [operationOf("choose", "ChooseInput")]),
    options,
  );
  expect(result.unwrapErr().map((issue) => issue.reason)).toContainEqual(
    expect.stringContaining("collides with ChooseSuccess"),
  );
});

test("an enumeration of several JSON kinds is emitted rather than rejected", () => {
  const mixed = {
    id: "Loose",
    name: "Loose",
    kind: "enum",
    members: [
      { name: "a", value: { kind: "string", value: "a" } },
      { name: "one", value: { kind: "number", text: "1" } },
      { name: "yes", value: { kind: "boolean", value: true } },
    ],
    exported: true,
    description: "",
    origin,
  } as const;
  expect(renderCSharp(modelOf([mixed]), options).isOk()).toBe(true);
});
