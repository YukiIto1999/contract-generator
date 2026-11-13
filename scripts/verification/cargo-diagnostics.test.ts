import { expect, test } from "vite-plus/test";
import { assertCleanCargo, type CompilerMessage } from "./cargo-diagnostics.ts";

const root = "/fixture";
const failure = { status: 101, stderr: "could not compile generated types" };
const mismatch: CompilerMessage = {
  level: "error",
  code: "E0308",
  rendered:
    "error[E0308]: mismatched types\n --> types/src/lib.rs:7:1\nexpected bool, found String",
  source: "/fixture/types/src/lib.rs",
};

test("repeated generated errors retain complete counts for every distinct code", () => {
  const overflow = {
    ...mismatch,
    code: "E0275",
    rendered:
      "error[E0275]: overflow evaluating requirement\n" + "note: nested requirement\n".repeat(100),
  };
  let caught: unknown;
  try {
    assertCleanCargo(root, failure, [...Array<CompilerMessage>(13_528).fill(mismatch), overflow]);
  } catch (error) {
    caught = error;
  }
  expect(caught).toMatchObject({
    actual: {
      errors: [
        { category: "E0308", count: 13_528 },
        { category: "E0275", count: 1 },
      ],
    },
  });
});
