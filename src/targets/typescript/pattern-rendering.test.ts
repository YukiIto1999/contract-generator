import { expect, test } from "vite-plus/test";
import type { ContractModel, EmissionOptions } from "../../model/contract-model.js";
import { preparePattern } from "../../model/patterns/compiled-pattern.js";
import { loadGenerated } from "./load-generated.js";
import { member, objectType, origin, scalarType } from "./model-builders.js";
import { renderTypeScript } from "./render-typescript.js";

/** Generator integration independent of an operation effect host */
const options: EmissionOptions = {
  targets: ["typescript"],
  csharpNamespace: "T",
  rustCratePrefix: "t",
  typescriptEffectModule: undefined,
};

/** Valid Unicode expressions outside the common execution capability */
const unsupported = [
  "(a)\\1",
  "(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)\\10",
  "(?<part>a)\\k<part>",
  "(?=a)a",
  "(?!a)b",
  "(?<=a)b",
  "(?<!a)b",
  "\\bword\\b",
  "\\B",
  "\\p{L}",
  "\\P{L}",
  "[\\p{L}]",
  "(?i:a)",
  "a{1001}",
  "(a{40}){40}",
  "\\uD800",
  "[\\uDC00]",
  "\ud800",
  "a{1000000000000000000000}",
  `a{0,${"9".repeat(400)}}`,
];

/**
 * Direct renderer model bypassing profile compilation
 * @param pattern - Original expression under test
 * @returns Synthetic contract with a located scalar restriction
 */
function model(pattern: string): ContractModel {
  return {
    namespace: "T",
    name: "T",
    operations: [],
    types: [scalarType("Text", "string", { constraints: { pattern } })],
  };
}

test.each(unsupported)(
  "rejects unsupported direct-renderer pattern %s before output",
  (pattern) => {
    const prepared = preparePattern(pattern);
    expect(prepared.isErr()).toBe(true);
    if (prepared.isErr()) expect(prepared.error.code).toBe("unsupported-pattern");
    const rendered = renderTypeScript(model(pattern), options);
    expect(rendered.isErr()).toBe(true);
    if (rendered.isErr())
      expect(rendered.error).toEqual([
        expect.objectContaining({
          code: "typescript-pattern",
          target: "typescript",
          origin,
          subject: "T.Text",
        }),
      ]);
  },
);

test.each(["(", "\\A"])(
  "rejects invalid Unicode syntax %s rather than accepting engine syntax",
  (pattern) => {
    const prepared = preparePattern(pattern);
    expect(prepared.isErr()).toBe(true);
    if (prepared.isErr()) expect(prepared.error.code).toBe("invalid-pattern");
    expect(renderTypeScript(model(pattern), options).isErr()).toBe(true);
  },
);

test("preflights located use-site patterns as well as scalar declarations", () => {
  const text = scalarType("Text", "string");
  const field = member("value", text);
  const object = objectType("Item", [
    { ...field, type: { ...field.type, constraints: { pattern: "(?=a)" } } },
  ]);
  const result = renderTypeScript(
    { namespace: "T", name: "T", types: [text, object], operations: [] },
    options,
  );
  expect(result.isErr()).toBe(true);
  if (result.isErr())
    expect(result.error).toEqual([
      expect.objectContaining({
        code: "typescript-pattern",
        origin,
        subject: "T.Item.value",
      }),
    ]);
});

test("emits one private compilation per distinct pattern and avoids import-name collisions", () => {
  const pattern = "^a+$";
  const types = [
    scalarType("First", "string", { constraints: { pattern } }),
    scalarType("Second", "string", { constraints: { pattern } }),
    scalarType("PatternEngine", "string", { constraints: { pattern: "^b+$" } }),
  ];
  const contract: ContractModel = { namespace: "T", name: "T", types, operations: [] };
  const files = renderTypeScript(contract, options).unwrap();
  const source = files.find((file) => file.path === "typescript/contract.ts")!.content;
  expect(source.match(/\.compile\(/g)).toHaveLength(2);
  expect(source).toContain('from "re2js"');
  expect(source).not.toContain("new RegExp");
  expect(source).not.toContain(".matches(");
  const codec = loadGenerated(contract).contract.PatternEngine as {
    create(value: string): { isOk(): boolean };
  };
  expect(codec.create("b").isOk()).toBe(true);
  expect(codec.create("a").isOk()).toBe(false);
});

test("pattern-free generated contracts have no engine dependency", () => {
  const contract: ContractModel = {
    namespace: "T",
    name: "T",
    operations: [],
    types: [scalarType("Text", "string")],
  };
  const files = renderTypeScript(contract, options).unwrap();
  expect(files.every((file) => !file.content.includes('from "re2js"'))).toBe(true);
});
