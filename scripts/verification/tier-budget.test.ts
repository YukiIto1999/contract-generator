import { expect, test } from "vite-plus/test";
import { tierSeconds } from "./tier-budget.ts";

/** `tiergate.json` that names each ceiling after the stage of the environment contract */
const declared = JSON.stringify({
  version: 1,
  verify: { seconds: 300, feedbackTargetSeconds: 120 },
  "verify-push": { seconds: 900, feedbackTargetSeconds: 600 },
});

test("the verify entry reads its ceiling from the verify key", () => {
  expect(tierSeconds(declared, "verify")).toBe(300);
});

test("the verify:push entry reads its ceiling from the verify-push key", () => {
  expect(tierSeconds(declared, "verify:push")).toBe(900);
});

test("the explicit full test run shares the verify-push ceiling", () => {
  expect(tierSeconds(declared, "test")).toBe(900);
});

test("a ceiling declared under the npm script name is not a verify-push ceiling", () => {
  const scriptNamed = JSON.stringify({ version: 1, "verify:push": { seconds: 900 } });
  expect(() => tierSeconds(scriptNamed, "verify:push")).toThrow("Missing finite");
});

test.each([
  ["a missing entry", { version: 1 }],
  ["a missing seconds value", { "verify-push": {} }],
  ["a text value", { "verify-push": { seconds: "900" } }],
  ["a zero value", { "verify-push": { seconds: 0 } }],
  ["a negative value", { "verify-push": { seconds: -1 } }],
])("%s is not a ceiling", (_name, declaration) => {
  expect(() => tierSeconds(JSON.stringify(declaration), "verify:push")).toThrow("Missing finite");
});
