import { expect } from "vite-plus/test";
import { runDriver } from "./csharp-process.js";
import { nativeTest, useContract } from "./csharp-suite.js";
import { buildCSharpProject, generatedDiagnostics } from "./csharp-toolchain.js";

/** Generated contract with multiple members in every nonempty closed family */
const contract = useContract("tests/fixtures/csharp/exhaustiveness.tsp", "Exhaustiveness", [
  "ExhaustivenessProbe.csproj",
]);

nativeTest(
  "compiles a real consumer matching every public closed variant without a catchall",
  () => {
    const build = contract.build("ExhaustivenessProbe.csproj");
    expect(build.status, build.output).toBe(0);
    expect(generatedDiagnostics(build), build.output).toEqual([]);
  },
);

nativeTest(
  "dispatches every union and mixed-enumeration case and normally rejects open wire inputs",
  async () => {
    const observations = await runDriver(contract.driver("ExhaustivenessProbe"), [
      { choice: { kind: "text", value: "hello" }, mixed: "yes" },
      { choice: { kind: "number", value: 1 }, mixed: 1 },
      { choice: { kind: "unknown", value: "hello" }, mixed: "unknown" },
      { choice: null, mixed: null },
    ]);
    expect(observations).toEqual([
      { choice: "text", mixed: "text" },
      { choice: "number", mixed: "number" },
      { choice: "rejected", mixed: "rejected" },
      { choice: "rejected", mixed: "rejected" },
    ]);
  },
);

nativeTest("fails consumer compilation when any public closed family omits a variant", () => {
  for (const probe of [
    "MissingChoice",
    "MissingMixed",
    "MissingSuccess",
    "MissingRejection",
    "MissingFailure",
    "MissingProviderFailure",
    "GuardedChoice",
    "OpenExpression",
  ]) {
    const build = buildCSharpProject(contract.fixture(), "ExhaustivenessProbe.csproj", {
      Probe: probe,
    });
    expect(build.status, build.output).not.toBe(0);
    expect(
      generatedDiagnostics(build).map((diagnostic) => `${diagnostic.severity} ${diagnostic.code}`),
      build.output,
    ).toEqual(["error CS8509"]);
  }
});

nativeTest("rejects a consumer closed-type switch statement with TYPMOD001 as an error", () => {
  const build = buildCSharpProject(contract.fixture(), "ExhaustivenessProbe.csproj", {
    Probe: "ClosedStatement",
  });
  expect(build.status, build.output).not.toBe(0);
  expect(
    generatedDiagnostics(build).map((diagnostic) => `${diagnostic.severity} ${diagnostic.code}`),
    build.output,
  ).toEqual(["error TYPMOD001"]);
});
