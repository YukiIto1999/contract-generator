import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect } from "vite-plus/test";
import { renderCSharp } from "../../../src/targets/csharp/render-csharp.js";
import { options } from "../../../src/targets/csharp/test-models.js";
import { contractModel } from "./csharp-contract.js";
import { evaluateAnalyzerAttachment, ownedAnalyzerProject } from "./csharp-evaluation.js";
import { nativeTest } from "./csharp-suite.js";
import {
  buildCSharpProject,
  generatedDiagnostics,
  type BuildConfiguration,
  type CSharpFixture,
} from "./csharp-toolchain.js";

/** Fixture projects and probes that the consumer of this tree reuses */
const fixtureSource = fileURLToPath(new URL("../../fixtures/csharp/", import.meta.url));
/** Contract with closed unions and operations whose outcomes a consumer must match exhaustively */
const source = "tests/fixtures/csharp/exhaustiveness.tsp";
/** Variables that the project tree must supply, because the build inherits none of them */
const treeSupplied = ["TypeModelingProjectPath", "EffectSystemProjectPath"];
/** The caller passes neither the dependency paths nor the generated root, so the tree above the projects has to */
const fromTree: BuildConfiguration = { without: treeSupplied, generatedRoot: false };
/** TypeModeling analyzer project that the TypeModeling checkout owns, which its props must attach */
const typeModelingAnalyzer = ownedAnalyzerProject("TypeModelingProjectPath", "TypeModeling");
/** EffectSystem analyzer project that the EffectSystem checkout owns, which its props must attach */
const effectSystemAnalyzer = ownedAnalyzerProject("EffectSystemProjectPath", "EffectSystem");
/** Directory below the tree whose props import the EffectSystem props themselves before the generated ones */
const ownerFirst = "owner-first";

/** Complete `Directory.Build.props` that the README tells a consumer to place at the root of its tree
 * @param typeModeling - Absolute path of the TypeModeling project
 * @param effectSystem - Absolute path of the EffectSystem project
 * @returns The one shared file: dependency paths, the generated output, and one import of each analysis file
 */
function sharedProps(typeModeling: string, effectSystem: string): string {
  return `<Project>
  <PropertyGroup>
    <TypeModelingProjectPath>${typeModeling}</TypeModelingProjectPath>
    <EffectSystemProjectPath>${effectSystem}</EffectSystemProjectPath>
    <GeneratedContractRoot>$(MSBuildThisFileDirectory)generated</GeneratedContractRoot>
  </PropertyGroup>
  <Import Project="$(GeneratedContractRoot)/csharp/Contract.Analysis.props" />
  <Import Project="$(GeneratedContractRoot)/csharp/Contract.EffectAnalysis.props" />
</Project>
`;
}

/** `Directory.Build.props` of a consumer that imports the owner's EffectSystem props, and through them the TypeModeling props, before the generated ones
 * @param typeModeling - Absolute path of the TypeModeling project
 * @param effectSystem - Absolute path of the EffectSystem project
 * @returns Shared file whose generated imports find the owner's props already imported
 */
function ownerFirstProps(typeModeling: string, effectSystem: string): string {
  return `<Project>
  <PropertyGroup>
    <TypeModelingProjectPath>${typeModeling}</TypeModelingProjectPath>
    <EffectSystemProjectPath>${effectSystem}</EffectSystemProjectPath>
    <GeneratedContractRoot>$(MSBuildThisFileDirectory)../generated</GeneratedContractRoot>
  </PropertyGroup>
  <Import Project="${join(dirname(effectSystemAnalyzer), "..", "..", "EffectSystem.Analysis.props")}" />
  <Import Project="$(GeneratedContractRoot)/csharp/Contract.Analysis.props" />
  <Import Project="$(GeneratedContractRoot)/csharp/Contract.EffectAnalysis.props" />
</Project>
`;
}

/** Tree whose root holds the shared props, with the generated output and a consumer below it */
let tree: CSharpFixture | undefined;

/**
 * Provisioned tree
 * @returns Directories of the tree
 * @throws {@link Error} A tree that was not provisioned before the tests
 */
function current(): CSharpFixture {
  if (tree === undefined) throw new Error("The tree was not provisioned");
  return tree;
}

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "contract-csharp-shared-props-"));
  const rendered = renderCSharp(await contractModel(source, "Exhaustiveness"), {
    ...options,
    csharpNamespace: "Exhaustiveness",
  });
  for (const file of rendered.unwrap()) {
    const path = join(root, "generated", file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
  await mkdir(join(root, "consumer"));
  for (const entry of ["ExhaustivenessProbe.csproj", "probes"])
    await cp(join(fixtureSource, entry), join(root, "consumer", entry), { recursive: true });
  await writeFile(
    join(root, "Directory.Build.props"),
    sharedProps(process.env.TypeModelingProjectPath!, process.env.EffectSystemProjectPath!),
  );
  await mkdir(join(root, ownerFirst, "consumer"), { recursive: true });
  for (const entry of ["ExhaustivenessProbe.csproj", "probes"])
    await cp(join(fixtureSource, entry), join(root, ownerFirst, "consumer", entry), {
      recursive: true,
    });
  await writeFile(
    join(root, ownerFirst, "Directory.Build.props"),
    ownerFirstProps(process.env.TypeModelingProjectPath!, process.env.EffectSystemProjectPath!),
  );
  tree = {
    root,
    generatedRoot: join(root, "generated"),
    fixtureRoot: root,
    artifactsRoot: join(root, "artifacts"),
  };
}, 120_000);

afterAll(async () => {
  if (tree !== undefined) await rm(tree.root, { recursive: true, force: true });
});

nativeTest("a generated project below the shared props builds without a warning", () => {
  const build = buildCSharpProject(
    current(),
    "generated/csharp/types/Contract.Types.csproj",
    {},
    fromTree,
  );
  expect(build.status, build.output).toBe(0);
  expect(generatedDiagnostics(build), build.output).toEqual([]);
});

nativeTest("every generated unit receives the dependency paths from the shared props alone", () => {
  for (const unit of [
    "types/Contract.Types",
    "provider/Contract.Provider",
    "client/Contract.Client",
  ]) {
    const build = buildCSharpProject(current(), `generated/csharp/${unit}.csproj`, {}, fromTree);
    expect(build.status, build.output).toBe(0);
    expect(generatedDiagnostics(build), build.output).toEqual([]);
  }
});

nativeTest("the shared import attaches each analyzer once, through the owner's props", () => {
  for (const project of [
    "generated/csharp/types/Contract.Types.csproj",
    "generated/csharp/provider/Contract.Provider.csproj",
    "generated/csharp/client/Contract.Client.csproj",
    "consumer/ExhaustivenessProbe.csproj",
  ]) {
    const attachment = evaluateAnalyzerAttachment(current(), project, fromTree);
    expect(attachment.typeModelingAnalyzerProject, project).toBe(typeModelingAnalyzer);
    expect(attachment.typeModelingReferences, project).toEqual([typeModelingAnalyzer]);
    expect(attachment.effectSystemAnalyzerProject, project).toBe(effectSystemAnalyzer);
    expect(attachment.effectSystemReferences, project).toEqual([effectSystemAnalyzer]);
    expect(attachment.output, project).not.toContain("MSB4011");
  }
});

nativeTest("the generated imports leave props that the consumer imported first alone", () => {
  const attachment = evaluateAnalyzerAttachment(
    current(),
    `${ownerFirst}/consumer/ExhaustivenessProbe.csproj`,
    { without: treeSupplied, generatedRoot: false },
  );
  expect(resolve(attachment.typeModelingAnalyzerProject)).toBe(typeModelingAnalyzer);
  expect(attachment.typeModelingReferences.map((path) => resolve(path))).toEqual([
    typeModelingAnalyzer,
  ]);
  expect(attachment.effectSystemReferences).toEqual([effectSystemAnalyzer]);
  expect(attachment.output).not.toContain("MSB4011");
});

nativeTest("a consumer in the tree compiles when it matches every variant", () => {
  const build = buildCSharpProject(current(), "consumer/ExhaustivenessProbe.csproj", {}, fromTree);
  expect(build.status, build.output).toBe(0);
  expect(generatedDiagnostics(build), build.output).toEqual([]);
});

nativeTest("a consumer in the tree is held to the analysis by the one shared import", () => {
  for (const [probe, diagnostic] of [
    ["MissingChoice", "error CS8509"],
    ["FutureChoice", "error TYPMOD021"],
    ["UnconstructedEffect", "error EFFSYS008"],
  ] as const) {
    const build = buildCSharpProject(
      current(),
      "consumer/ExhaustivenessProbe.csproj",
      { Probe: probe },
      fromTree,
    );
    expect(build.status, build.output).not.toBe(0);
    expect(
      generatedDiagnostics(build).map((entry) => `${entry.severity} ${entry.code}`),
      build.output,
    ).toEqual([diagnostic]);
  }
});
