import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "vite-plus/test";
import { renderCSharp } from "../../../src/targets/csharp/render-csharp.js";
import { options } from "../../../src/targets/csharp/test-models.js";
import { contractModel } from "./csharp-contract.js";
import {
  buildCSharpProject,
  detectCSharpToolchain,
  driverAssembly,
  provisionCSharpFixture,
  type CSharpFixture,
  type NativeBuild,
} from "./csharp-toolchain.js";

const source = `import "../../../lib/main.tsp";
using ContractGenerator;
namespace DepthFixture;
model Stable { value: string; }
model ObjectNode {
  @minLength(1) value: string;
  child?: ObjectNode | null;
  @providerDefault("fallback") note?: string | null;
  stable?: Stable;
}
model ArrayNode is Array<ArrayNode>;
model EndNode { kind: "end"; @minLength(1) value: string; }
model StepNode { kind: "step"; next: Choice; }
@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
union Choice { end: EndNode, step: StepNode }
model DefaultLeaf { @providerDefault("fallback") note?: string; }
model DefaultBranch { @providerDefault(#{}) leaf?: DefaultLeaf; }
@outcomes union EchoOutcomes { ok: Stable }
op echo(root: ObjectNode, arrays?: ArrayNode, choice?: Choice, @providerDefault(#{}) branch?: DefaultBranch): EchoOutcomes;
@@publish(echo, #["http"]);
@@httpBinding(echo, "POST", "/echo");
@@httpResult(echo, "ok", 200, "application/json");
`;

const project = `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <LangVersion>14</LangVersion>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <EnableDefaultCompileItems>false</EnableDefaultCompileItems>
    <GenerateDocumentationFile>true</GenerateDocumentationFile>
  </PropertyGroup>
  <ItemGroup>
    <Compile Include="DepthDriver.cs" />
    <ProjectReference Include="$(GeneratedContractRoot)/csharp/types/Contract.Types.csproj" />
    <ProjectReference Include="$(GeneratedContractRoot)/csharp/provider/Contract.Provider.csproj" />
  </ItemGroup>
</Project>
`;

let fixture: CSharpFixture | undefined;
let build: NativeBuild | undefined;
if (detectCSharpToolchain().available)
  beforeAll(async () => {
    const rendered = renderCSharp(
      await contractModel("tests/fixtures/csharp/depth.tsp", "DepthFixture", source),
      { ...options, csharpNamespace: "DepthFixture" },
    );
    if (rendered.isErr()) throw new Error(JSON.stringify(rendered.error));
    fixture = await provisionCSharpFixture(
      await mkdtemp(join(tmpdir(), "contract-csharp-depth-")),
      rendered.value,
    );
    await writeFile(join(fixture.fixtureRoot, "DepthDriver.csproj"), project);
    build = buildCSharpProject(fixture, "DepthDriver.csproj");
    if (build.status !== 0) throw new Error(build.output);
  }, 1_200_000);
afterAll(async () => {
  if (fixture) await rm(fixture.root, { recursive: true, force: true });
});

export function depthDriver(): string {
  if (!fixture) throw new Error("Depth fixture was not built");
  return driverAssembly(fixture, "DepthDriver");
}

export function depthBuild(): NativeBuild {
  if (!build) throw new Error("Depth fixture was not built");
  return build;
}
