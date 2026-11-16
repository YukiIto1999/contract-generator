import { expect, test } from "vite-plus/test";
import type { ContractModel, ScalarType } from "../../model/contract-model.js";
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

/**
 * Scalar text that carries a pattern
 * @param id - Stable identity, also used as name
 * @param pattern - Authored ECMAScript Unicode pattern
 * @returns Resolved scalar
 */
function patterned(id: string, pattern: string): ScalarType {
  return { ...scalarOf(id, "string"), constraints: { pattern } };
}

/**
 * Source of the generated types assembly
 * @param model - Contract that renders
 * @returns Content of `ContractTypes.cs`
 */
function typesSource(model: ContractModel): string {
  const files = renderCSharp(model, options).unwrap();
  return files.find((file) => file.path === "csharp/types/ContractTypes.cs")!.content;
}

test("an ECMAScript pattern outside the common profile is rejected at its declaration with the original position", () => {
  const result = renderCSharp(modelOf([patterned("Pattern", "(?<=a)b")]), options);
  expect(result.unwrapErr()[0]).toMatchObject({ target: "csharp", origin, subject: "Pattern" });
});

test("an admitted pattern becomes a linear-time matcher that the text check receives", () => {
  const source = typesSource(modelOf([patterned("Code", "^[a-z]+$")]));
  expect(source).toContain(
    String.raw`internal static readonly Regex DeclaredPattern0 = new("\\A(?:[\\u0061-\\u007A])+\\z", RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);`,
  );
  expect(source).toContain("Wire.Text(value, null, null, false, Wire.DeclaredPattern0, c, path);");
});

test("a contract without a pattern generates no matcher and passes none to the text check", () => {
  const source = typesSource(modelOf([scalarOf("Plain", "string")]));
  expect(source).not.toContain("DeclaredPattern");
  expect(source).toContain("Wire.Text(value, null, null, false, null, c, path);");
});

test("each distinct pattern has one matcher named by its source, never by declaration order", () => {
  const model = modelOf([
    patterned("Beta", "^b$"),
    patterned("Alpha", "^a$"),
    patterned("Again", "^b$"),
  ]);
  const source = typesSource(model);
  expect(source.match(/DeclaredPattern\d+ = new/g)).toEqual([
    "DeclaredPattern0 = new",
    "DeclaredPattern1 = new",
  ]);
  expect(source.indexOf(String.raw`"\\A\\u0061\\z"`)).toBeLessThan(
    source.indexOf(String.raw`"\\A\\u0062\\z"`),
  );
  expect(typesSource({ ...model, types: [...model.types].reverse() })).toBe(source);
});

test("a pattern at a use site reaches the text check of that position", () => {
  const code = field("code", { ...use("Plain"), constraints: { pattern: "^x$" } });
  const source = typesSource(modelOf([scalarOf("Plain", "string"), objectOf("Item", [code])]));
  expect(source).toContain("Wire.Text(value!, null, null, false, Wire.DeclaredPattern0, c, path);");
});

test("a pattern that the .NET engine cannot build is rejected at its declaration", () => {
  const issue = renderCSharp(modelOf([patterned("Wide", "^.{667}$")]), options).unwrapErr()[0]!;
  expect([issue.target, issue.origin, issue.subject]).toEqual(["csharp", origin, "Wide"]);
  expect(issue.reason).toContain("10010");
});

test("a pattern on a declaration that holds no text is rejected", () => {
  const count = { ...scalarOf("Count", "int32"), constraints: { pattern: "^1$" } };
  const issue = renderCSharp(modelOf([count]), options).unwrapErr()[0]!;
  expect(issue).toMatchObject({ target: "csharp", subject: "Count" });
  expect(issue.reason).toContain("text");
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
