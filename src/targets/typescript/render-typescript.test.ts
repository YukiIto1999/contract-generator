import { expect, test } from "vite-plus/test";
import type { ContractModel, EmissionOptions } from "../../model/contract-model.js";
import { httpSampleModel, scalarType } from "./model-builders.js";
import { renderTypeScript } from "./render-typescript.js";

/** Caller-owned Effect integration */
const options: EmissionOptions = {
  targets: ["typescript"],
  typescriptEffectModule: "./effect.js",
  csharpNamespace: "Sample",
  rustCratePrefix: "sample",
};

test("generation order is independent of declaration enumeration", () => {
  const model = httpSampleModel();
  const first = renderTypeScript(model, options);
  const reversed = renderTypeScript(
    { ...model, types: [...model.types].reverse(), operations: [...model.operations].reverse() },
    options,
  );
  expect(first.isOk() && reversed.isOk()).toBe(true);
  if (first.isOk() && reversed.isOk()) expect(first.value).toEqual(reversed.value);
});

test("a missing Effect module with operations is a source-addressed issue", () => {
  const result = renderTypeScript(httpSampleModel(), {
    ...options,
    typescriptEffectModule: undefined,
  });
  expect(result.isErr()).toBe(true);
  if (result.isErr())
    expect(result.error[0]).toMatchObject({
      target: "typescript",
      code: "typescript-effect-module",
      origin: { file: expect.any(String), line: expect.any(Number) },
    });
});

test("a contract without operations needs no Effect module", () => {
  const model: ContractModel = {
    namespace: "T",
    name: "T",
    types: [scalarType("Text", "string")],
    operations: [],
  };
  expect(renderTypeScript(model, { ...options, typescriptEffectModule: undefined }).isOk()).toBe(
    true,
  );
});

test("duplicate declaration names and invalid patterns are source-addressed issues", () => {
  const model: ContractModel = {
    namespace: "T",
    name: "T",
    types: [
      scalarType("Text", "string"),
      { ...scalarType("Text", "string"), id: "T.Other" },
      scalarType("Broken", "string", { constraints: { pattern: "(" } }),
    ],
    operations: [],
  };
  const result = renderTypeScript(model, options);
  expect(result.isErr() && result.error.map((issue) => issue.code).sort()).toEqual([
    "typescript-name",
    "typescript-pattern",
  ]);
});
