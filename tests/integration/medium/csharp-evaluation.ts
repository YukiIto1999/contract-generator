import { basename, dirname, join, resolve } from "node:path";
import { runDotnet, type BuildConfiguration, type CSharpFixture } from "./csharp-toolchain.js";

/** Item of an evaluation report */
interface ReportedItem {
  /** Include as evaluated */
  readonly Identity: string;
}

/** Items of an evaluation report grouped by item type */
interface ReportedItems {
  /** Project references of the project */
  readonly ProjectReference?: readonly ReportedItem[];
}

/** Properties and items of one project as MSBuild prints them */
interface EvaluationReport {
  /** Evaluated value of each requested property */
  readonly Properties?: Readonly<Record<string, string>>;
  /** Evaluated items grouped by item type */
  readonly Items?: ReportedItems;
}

/** Analyzer attachment that MSBuild evaluated for one project without building it */
export interface AnalyzerAttachment {
  /** `TypeModelingAnalyzerProject` from the TypeModeling props, empty when they were not imported */
  readonly typeModelingAnalyzerProject: string;
  /** `EffectSystemAnalyzerProject` from the EffectSystem props, empty when they were not imported */
  readonly effectSystemAnalyzerProject: string;
  /** Project references that name the TypeModeling analyzer project */
  readonly typeModelingReferences: readonly string[];
  /** Project references that name the EffectSystem analyzer project */
  readonly effectSystemReferences: readonly string[];
  /** Complete output retained for failure reports, which holds a warning about a repeated import */
  readonly output: string;
}

/** Analyzer project that a dependency checkout owns
 * @param variable - Environment variable that names the dependency's runtime project, which sits at `src/<Name>/<Name>.csproj`
 * @param name - Dependency name that prefixes its analyzer project
 * @returns Absolute path of `src/<Name>.Analyzers/<Name>.Analyzers.csproj` in the same checkout
 */
export function ownedAnalyzerProject(variable: string, name: string): string {
  const checkout = resolve(dirname(process.env[variable]!), "..", "..");
  return join(checkout, "src", `${name}.Analyzers`, `${name}.Analyzers.csproj`);
}

/** Report that MSBuild prints between the first and last brace lines of its output
 * @param output - Standard output and error of the evaluation
 * @returns Parsed report
 * @throws {@link Error} An output without a report
 */
function parseReport(output: string): EvaluationReport {
  const lines = output.split("\n");
  const first = lines.indexOf("{");
  const last = lines.lastIndexOf("}");
  if (first < 0 || last < first) throw new Error(`The evaluation printed no report:\n${output}`);
  return JSON.parse(lines.slice(first, last + 1).join("\n")) as EvaluationReport;
}

/** Analyzer attachment of one project after evaluation
 *
 * The evaluation neither restores nor builds, so it observes what the imported props decided and not what a build made of it.
 * @param fixture - Provisioned directories
 * @param project - Project file path relative to the fixture copy
 * @param configuration - What the evaluation must find in the project tree instead of receiving it
 * @returns Analyzer properties and the project references that name an analyzer project
 * @throws {@link Error} An evaluation that failed
 */
export function evaluateAnalyzerAttachment(
  fixture: CSharpFixture,
  project: string,
  { without = [], generatedRoot = true }: BuildConfiguration = {},
): AnalyzerAttachment {
  const evaluation = runDotnet(
    fixture,
    [
      "msbuild",
      join(fixture.fixtureRoot, project),
      "-getProperty:TypeModelingAnalyzerProject,EffectSystemAnalyzerProject",
      "-getItem:ProjectReference",
      ...(generatedRoot ? [`-p:GeneratedContractRoot=${fixture.generatedRoot}`] : []),
      "-nologo",
    ],
    without,
  );
  if (evaluation.status !== 0) throw new Error(`The evaluation failed:\n${evaluation.output}`);
  const report = parseReport(evaluation.output);
  const references = (report.Items?.ProjectReference ?? []).map((item) => item.Identity);
  return {
    typeModelingAnalyzerProject: report.Properties?.TypeModelingAnalyzerProject ?? "",
    effectSystemAnalyzerProject: report.Properties?.EffectSystemAnalyzerProject ?? "",
    typeModelingReferences: references.filter(
      (identity) => basename(identity) === "TypeModeling.Analyzers.csproj",
    ),
    effectSystemReferences: references.filter(
      (identity) => basename(identity) === "EffectSystem.Analyzers.csproj",
    ),
    output: evaluation.output,
  };
}
