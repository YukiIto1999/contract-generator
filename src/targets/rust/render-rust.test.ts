import { expect, test } from "vite-plus/test";
import type { ContractModel, EmissionOptions } from "../../model/contract-model.js";
import { renderRust } from "./render-rust.js";
import {
  contract,
  integer,
  literal,
  member,
  object,
  operation,
  origin,
  text,
  union,
  use,
} from "./test-models.js";

const options: EmissionOptions = {
  targets: ["rust"],
  rustCratePrefix: "probe",
  csharpNamespace: "Test",
  typescriptEffectModule: undefined,
};
const tree = object("Tree", [
  member("label", use("Test.Text")),
  member("child", use("Test.Tree", true), true),
]);
const recursiveTree = contract(
  [text("Text"), tree],
  [operation("grow", "Tree"), operation("prune", "Tree")],
  ["Tree", "Tree"],
);
const expression = contract(
  [
    integer("Count"),
    literal("NumKind", "num"),
    literal("AddKind", "add"),
    object("Num", [member("kind", use("Test.NumKind")), member("value", use("Test.Count"))]),
    object("Add", [
      member("kind", use("Test.AddKind")),
      member("left", use("Test.Expr")),
      member("right", use("Test.Expr")),
    ]),
    union("Expr", [
      ["num", "Num"],
      ["add", "Add"],
    ]),
  ],
  [operation("evaluate", "Expr")],
  ["Expr"],
);

/** Reasons of every refusal of a model
 * @param model - Contract handed to the Rust target
 * @returns Source-addressed reasons, empty when the target accepts the model
 */
function refusals(model: ContractModel): string[] {
  const rendered = renderRust(model, options);
  return rendered.isErr()
    ? rendered.error.map((issue) => `${issue.code}@${issue.origin.line}: ${issue.reason}`)
    : [];
}

test("renders identical files whatever the enumeration order of declarations and operations", () => {
  const normal = renderRust(recursiveTree, options);
  const reversed = renderRust(
    {
      ...recursiveTree,
      types: [...recursiveTree.types].reverse(),
      operations: [...recursiveTree.operations].reverse(),
    },
    options,
  );
  expect(normal.isOk()).toBe(true);
  if (normal.isOk() && reversed.isOk()) expect(reversed.value).toEqual(normal.value);
  else expect(reversed.isOk()).toBe(true);
});

test("accepts a type that recurses through an optional nullable member", () => {
  expect(refusals(recursiveTree)).toEqual([]);
});

test("accepts a type that recurses through a union case", () => {
  expect(refusals(expression)).toEqual([]);
});

test("refuses a declaration that collides with a generated name and addresses it at its source", () => {
  const collision = contract([text("Accepted")], [], []);
  expect(refusals(collision)).toEqual([
    "rust-unsupported@1: Rust declaration Accepted collides with another generated declaration",
  ]);
});

test("does not reserve private parser spellings or removed DOM names", () => {
  const model = contract(
    ["Json", "JsonNode", "JsonWriter", "Path", "Value", "Map"].map((name) => text(name)),
    [],
    [],
  );
  expect(refusals(model)).toEqual([]);
});

test("refuses a public HTTP projection type that collides with a canonical declaration", () => {
  const model = contract(
    [text("Text"), text("SendHttpPlacements")],
    [operation("send", "Text")],
    ["Text"],
  );
  expect(refusals(model)).toContain(
    "rust-unsupported@1: Rust operation declaration SendHttpPlacements collides with another generated declaration",
  );
});

test("refuses a unix timestamp encoding that cannot keep the temporal profile", () => {
  const model = contract([text("Stamp", "unixTimestamp")], [], []);
  expect(refusals(model).join("\n")).toContain("Unix timestamp encoding cannot preserve");
});

test("refuses a provider default that its Rust storage cannot hold without a run-time failure", () => {
  const defaulted = {
    ...member("limit", use("Test.Count"), true),
    default: { kind: "string" as const, value: "many" },
  };
  const model = contract([integer("Count"), object("Options", [defaulted])], [], []);
  expect(refusals(model).join("\n")).toContain("provider default cannot be built");
});

test("accepts a bytes-free numeric default that fits its storage", () => {
  const defaulted = {
    ...member("limit", use("Test.Count"), true),
    default: { kind: "number" as const, text: "7" },
  };
  expect(refusals(contract([integer("Count"), object("Options", [defaulted])], [], []))).toEqual(
    [],
  );
});

test("refuses an HTTP method that has no request constant", () => {
  const model = contract([text("Text"), tree], [operation("grow", "Tree", "PROPFIND")], ["Tree"]);
  expect(refusals(model).join("\n")).toContain("HTTP method PROPFIND has no Rust request constant");
});

test("refuses a reference that is absent from the normalized model with the position of its use", () => {
  const model = contract(
    [
      object("Broken", [
        member("missing", { ...use("Test.Nowhere"), origin: { ...origin, line: 7 } }),
      ]),
    ],
    [],
    [],
  );
  expect(refusals(model)).toEqual([
    "rust-unsupported@7: Resolved Rust type reference is absent from the normalized model",
  ]);
});

test("refuses a crate prefix that Cargo would not accept", () => {
  const rendered = renderRust(recursiveTree, { ...options, rustCratePrefix: "Not A Prefix" });
  expect(rendered.isErr()).toBe(true);
});
