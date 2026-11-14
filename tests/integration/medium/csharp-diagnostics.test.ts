import { expect, test } from "vite-plus/test";
import { renderCSharp } from "../../../src/targets/csharp/render-csharp.js";
import { options } from "../../../src/targets/csharp/test-models.js";
import { contractModel } from "./csharp-contract.js";

/** Contract with an encoding that C# cannot keep and a name that collides with a generated family */
const contract = [
  'import "../../../lib/main.tsp";',
  "using ContractGenerator;",
  "namespace Inline;",
  "scalar UnixInstant extends utcDateTime;",
  '@@bindingEncoding(UnixInstant, "http", "unixTimestamp");',
  '@@bindingEncoding(UnixInstant, "ipc", "rfc3339");',
  "model Stamp { at: UnixInstant; }",
  "model Payload { value: string; }",
  "model ChooseSuccess { value: string; }",
  "@outcomes union Results { first: Payload }",
  "op choose(input: Stamp): Results;",
  '@@publish(choose, #["http"]);',
  '@@httpBinding(choose, "POST", "/choose");',
  '@@httpResult(choose, "first", 200, "application/json");',
].join("\n");

test("reports an inexact encoding and a generated-name collision at their original declarations", async () => {
  const source = "tests/fixtures/csharp/unsupported.tsp";
  const result = renderCSharp(await contractModel(source, "Inline", contract), {
    ...options,
    csharpNamespace: "Inline",
  });
  const issues = result.unwrapErr();
  expect(
    issues.map((issue) => [
      issue.code,
      issue.target,
      issue.subject,
      issue.origin.file.endsWith("unsupported.tsp"),
      issue.origin.line,
    ]),
  ).toEqual(
    expect.arrayContaining([
      ["unsupported-csharp", "csharp", "Inline.UnixInstant", true, 4],
      ["unsupported-csharp", "csharp", "Inline.choose.Success", true, 11],
    ]),
  );
});
