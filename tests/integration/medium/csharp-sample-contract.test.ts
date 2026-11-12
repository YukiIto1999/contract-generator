import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect } from "vite-plus/test";
import { sampleSource } from "./csharp-contract.js";
import { observeCSharpCodecCases, observeCSharpPresenceCases } from "./csharp-codec-observation.js";
import { nativeTest, useContract } from "./csharp-suite.js";
import { buildCSharpProject, generatedDiagnostics } from "./csharp-toolchain.js";

/** Sample contract with the types-only codec driver */
const sample = useContract(sampleSource, "Sample", ["CodecDriver.csproj"]);

/** Communication and compile-time assemblies that a types-only consumer must never load */
const forbidden =
  /EffectSystem|Contract\.(Provider|Client)|TypeModeling\.Analyzers|Microsoft\.CodeAnalysis/;

nativeTest(
  "compiles the generated units and the codec driver without a compiler diagnostic of their own",
  () => {
    expect(
      generatedDiagnostics(sample.build("CodecDriver.csproj")).map((diagnostic) => diagnostic.text),
    ).toEqual([]);
  },
);

nativeTest("accepts the alias and rejects exchanged nominal roles with CS0029 only (G1)", () => {
  const alias = buildCSharpProject(sample.fixture(), "RoleProbe.csproj", {
    Probe: "AliasAccepted",
  });
  expect([alias.status, alias.diagnostics], alias.output).toEqual([0, []]);
  for (const [probe, from, to] of [
    ["RejectRecordAsRequest", "Sample.RecordId", "Sample.RequestId"],
    ["RejectRequestAsRecord", "Sample.RequestId", "Sample.RecordId"],
  ] as const) {
    const rejected = buildCSharpProject(sample.fixture(), "RoleProbe.csproj", { Probe: probe });
    expect(rejected.status, rejected.output).not.toBe(0);
    expect(
      rejected.diagnostics.map((d) => `${d.severity} ${d.code}`),
      rejected.output,
    ).toEqual(["error CS0029"]);
    expect(rejected.diagnostics[0]!.text).toContain(`'${from}' to '${to}'`);
  }
});

nativeTest(
  "builds the types-only driver without HTTP, provider, client or EffectSystem assemblies (G13)",
  async () => {
    const output = dirname(sample.driver("CodecDriver"));
    const files = await readdir(output);
    expect(files).toEqual(expect.arrayContaining(["Contract.Types.dll", "TypeModeling.dll"]));
    expect(files.filter((file) => forbidden.test(file))).toEqual([]);
    const dependencies = JSON.parse(
      await readFile(join(output, "CodecDriver.deps.json"), "utf8"),
    ) as {
      libraries: Record<string, unknown>;
    };
    expect(
      Object.keys(dependencies.libraries).filter((library) => forbidden.test(library)),
    ).toEqual([]);
  },
);

nativeTest(
  "applies Unicode code-point lengths, exact numeric and temporal tokens, variants and unknown fields (G2 G3 G5 G6)",
  async () => {
    expect((await observeCSharpCodecCases(sample.driver("CodecDriver"))).length).toBeGreaterThan(0);
  },
);

nativeTest(
  "distinguishes missing, null and undefined presence and rejects ownership and default-value bypasses (G4 G5 G6)",
  async () => {
    expect((await observeCSharpPresenceCases(sample.driver("CodecDriver"))).length).toBeGreaterThan(
      0,
    );
  },
);
