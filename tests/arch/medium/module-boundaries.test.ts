import { expect, test } from "vite-plus/test";
import {
  architectureViolations,
  importViolation,
} from "../../../scripts/verification/architecture.ts";
import { suiteInventory } from "../../../scripts/verification/suites.ts";

test("the public emitter preserves private IR and one-way generator seams", () => {
  expect(architectureViolations()).toEqual([]);
});

test("every discovered test module has exactly one nonempty acceptance collection", () => {
  const inventory = suiteInventory();
  const modules = Object.values(inventory).flat();
  expect(modules.length).toBeGreaterThan(0);
  expect(new Set(modules).size).toBe(modules.length);
  expect(Object.values(inventory).every((paths) => paths.length > 0)).toBe(true);
});

test.each([
  [
    "src/model/contract-model.ts",
    "../profile/compile-contract.js",
    "src/profile/compile-contract.ts",
    "src/model",
  ],
  [
    "src/targets/rust/render-rust.ts",
    "../../profile/library.js",
    "src/profile/library.ts",
    "src/targets/rust",
  ],
  [
    "src/targets/rust/render-rust.ts",
    "../csharp/render-csharp.js",
    "src/targets/csharp/render-csharp.ts",
    "src/targets/rust",
  ],
  [
    "src/projections/render-projections.ts",
    "../../tests/fixture.js",
    "tests/fixture.ts",
    "src/projections",
  ],
])("%s rejects %s with the actual edge and required seam", (owner, specifier, target, expected) => {
  const violation = importViolation(owner, { specifier, target });
  expect(violation).toContain("generator-seams");
  expect(violation).toContain(owner);
  expect(violation).toContain(target);
  expect(violation).toContain(`expected ${expected}`);
});

test("a renderer cannot interpret compiler metadata directly", () => {
  const violation = importViolation("src/targets/rust/render-rust.ts", {
    specifier: "@typespec/compiler",
    target: undefined,
  });
  expect(violation).toContain("generator-dependencies");
  expect(violation).toContain("@typespec/compiler");
  expect(violation).toContain("compiler access in profile/root composition only");
});

test("profile compiler options and renderer IR references remain permitted", () => {
  expect(
    importViolation("src/profile/library.ts", {
      specifier: "../emitter-options.js",
      target: "src/emitter-options.ts",
    }),
  ).toBeUndefined();
  expect(
    importViolation("src/targets/rust/render-rust.ts", {
      specifier: "../../model/contract-model.js",
      target: "src/model/contract-model.ts",
    }),
  ).toBeUndefined();
});

test("nested shared semantics keep their model ownership without exposing the compiler", () => {
  expect(
    importViolation("src/profile/constraints.ts", {
      specifier: "../model/patterns/compiled-pattern.js",
      target: "src/model/patterns/compiled-pattern.ts",
    }),
  ).toBeUndefined();
  expect(
    importViolation("src/model/patterns/compiled-pattern.ts", {
      specifier: "../../profile/constraints.js",
      target: "src/profile/constraints.ts",
    }),
  ).toContain("generator-seams");
  expect(
    importViolation("src/model/patterns/compiled-pattern.ts", {
      specifier: "@typespec/compiler",
      target: undefined,
    }),
  ).toContain("generator-dependencies");
});

test("pattern parser and matcher dependencies stay inside shared pattern semantics", () => {
  for (const specifier of ["@eslint-community/regexpp", "re2js"]) {
    expect(
      importViolation("src/model/patterns/compiled-pattern.ts", { specifier, target: undefined }),
    ).toBeUndefined();
    expect(
      importViolation("src/targets/typescript/contract-checks.ts", {
        specifier,
        target: undefined,
      }),
    ).toContain("generator-dependencies");
  }
});
