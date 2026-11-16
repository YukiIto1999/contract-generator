import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, expect } from "vite-plus/test";
import { renderCSharp } from "../../../src/targets/csharp/render-csharp.js";
import { options } from "../../../src/targets/csharp/test-models.js";
import { contractModel } from "./csharp-contract.js";
import { evaluateAnalyzerAttachment } from "./csharp-evaluation.js";
import { nativeTest } from "./csharp-suite.js";
import {
  buildCSharpProject,
  generatedDiagnostics,
  type CSharpFixture,
} from "./csharp-toolchain.js";

/** Contract with closed unions and operations, which gives all three units something to compile */
const source = "tests/fixtures/csharp/exhaustiveness.tsp";
/** Generated unit projects, whose imports a consumer's props must not have to repeat */
const units = [
  "generated/csharp/types/Contract.Types.csproj",
  "generated/csharp/provider/Contract.Provider.csproj",
  "generated/csharp/client/Contract.Client.csproj",
];

/** Generated output whose directory has no `Directory.Build.props` above it */
let output: CSharpFixture | undefined;

/**
 * Provisioned output
 * @returns Directories of the output
 * @throws {@link Error} An output that was not provisioned before the tests
 */
function current(): CSharpFixture {
  if (output === undefined) throw new Error("The output was not provisioned");
  return output;
}

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), "contract-csharp-outside-tree-"));
  const rendered = renderCSharp(await contractModel(source, "Exhaustiveness"), {
    ...options,
    csharpNamespace: "Exhaustiveness",
  });
  for (const file of rendered.unwrap()) {
    const path = join(root, "generated", file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
  output = {
    root,
    generatedRoot: join(root, "generated"),
    fixtureRoot: root,
    artifactsRoot: join(root, "artifacts"),
  };
}, 120_000);

afterAll(async () => {
  if (output !== undefined) await rm(output.root, { recursive: true, force: true });
});

nativeTest("a generated project attaches no analyzer of its own", () => {
  for (const project of units) {
    const attachment = evaluateAnalyzerAttachment(current(), project);
    expect(attachment.typeModelingAnalyzerProject, project).toBe("");
    expect(attachment.typeModelingReferences, project).toEqual([]);
    expect(attachment.effectSystemAnalyzerProject, project).toBe("");
    expect(attachment.effectSystemReferences, project).toEqual([]);
  }
});

nativeTest(
  "a generated project builds from the environment's dependency paths with only the exhaustiveness warnings that the analyzer would suppress",
  () => {
    for (const project of units) {
      const build = buildCSharpProject(current(), project);
      expect(build.status, build.output).toBe(0);
      const diagnostics = generatedDiagnostics(build).map(
        (diagnostic) => `${diagnostic.severity} ${diagnostic.code}`,
      );
      expect(
        diagnostics.filter((diagnostic) => diagnostic !== "warning CS8509"),
        build.output,
      ).toEqual([]);
      if (project.includes("/types/"))
        expect(diagnostics, build.output).toContain("warning CS8509");
    }
  },
);
