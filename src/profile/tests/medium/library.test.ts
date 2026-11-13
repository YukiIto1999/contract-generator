import { NoTarget } from "@typespec/compiler";
import { expect, test } from "vite-plus/test";
import { $lib } from "../../library.js";
import { compileSource } from "./profile-source.fixture.js";

test("the publication cleanup diagnostic is a warning that lists the remaining paths", async () => {
  const { program } = await compileSource("namespace Public;");
  const before = program.diagnostics.length;
  $lib.reportDiagnostic(program, {
    code: "publication-cleanup",
    target: NoTarget,
    format: { paths: ".out.tmp, .out.old" },
  });
  const reported = program.diagnostics.slice(before);
  expect(reported).toHaveLength(1);
  expect(reported[0]).toMatchObject({
    severity: "warning",
    code: "@yukiito1999/contract-generator/publication-cleanup",
    message: "Generated output was published but temporary paths remain: .out.tmp, .out.old",
  });
});

test("the publication failure diagnostic stays an error", async () => {
  const { program } = await compileSource("namespace Public;");
  const before = program.diagnostics.length;
  $lib.reportDiagnostic(program, {
    code: "publication-failure",
    target: NoTarget,
    format: { message: "could not replace output", rule: "replace-failed" },
  });
  expect(program.diagnostics.slice(before)).toMatchObject([
    { severity: "error", message: "could not replace output [replace-failed]" },
  ]);
});
