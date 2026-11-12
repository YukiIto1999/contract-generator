import { Err, Ok, type Result } from "ts-results-es";
import type {
  ContractModel,
  EmissionOptions,
  GeneratedFile,
  GenerationIssue,
} from "../../model/contract-model.js";
import { renderAcceptance } from "./acceptance.js";
import { renderClient } from "./client-unit.js";
import { CSharpContext } from "./context.js";
import { collectIssues } from "./issues.js";
import { lines, name } from "./naming.js";
import { renderOperationTypes } from "./outcomes.js";
import { project } from "./project-files.js";
import { acceptanceNodes, renderProviderDefaults } from "./provider-defaults.js";
import { renderProvider } from "./provider-unit.js";
import { renderType } from "./render-type.js";
import { runtime } from "./runtime.js";

/** Namespaces that every generated source file imports */
const baseUsings = [
  "System",
  "System.Collections.Generic",
  "System.Collections.Immutable",
  "System.Globalization",
  "System.IO",
  "System.Linq",
  "System.Numerics",
  "System.Text",
  "System.Text.Json",
  "System.Text.RegularExpressions",
  "TypeModeling.Domain",
];

/** Header of one generated source file
 * @param extraUsings - Namespaces beyond the shared ones
 * @returns Nullable context and using directives
 */
function header(extraUsings: readonly string[] = []): string {
  return lines(
    "#nullable enable",
    ...[...baseUsings, ...extraUsings].map((namespace) => `using ${namespace};`),
  );
}

/** Pure types unit with the runtime, every declaration and provider acceptance
 * @param c - Target context
 * @param namespace - Escaped root namespace
 * @returns Source of the types assembly
 */
function typesSource(c: CSharpContext, namespace: string): string {
  const needs = acceptanceNodes(c);
  return lines(
    header(),
    `namespace ${namespace};`,
    runtime,
    ...c.model.types.map((node) => renderType(c, node)),
    renderProviderDefaults(c, needs),
    renderAcceptance(c, needs),
    renderOperationTypes(c),
  );
}

/** Dependent unit source that imports the types assembly
 * @param namespace - Escaped root namespace
 * @param unit - Unit namespace suffix
 * @param body - Unit declarations
 * @returns Source of one dependent assembly
 */
function unitSource(namespace: string, unit: "Provider" | "Client", body: string): string {
  return lines(
    header([
      "System.Net.Http",
      "System.Threading",
      "System.Threading.Tasks",
      "EffectSystem.Domain",
      namespace,
    ]),
    `namespace ${namespace}.${unit};`,
    body,
  );
}

/** Complete deterministic C# contract emission
 * @param model - Compiler-independent normalized contract
 * @param options - Caller-owned output integration
 * @returns All C# units or source-addressed generation issues
 */
export function renderCSharp(
  model: ContractModel,
  options: EmissionOptions,
): Result<readonly GeneratedFile[], readonly GenerationIssue[]> {
  const c = new CSharpContext(model, options.csharpNamespace);
  const issues = collectIssues(c);
  if (issues.length > 0) return Err(issues);
  const namespace = options.csharpNamespace.split(".").map(name).join(".");
  return Ok([
    { path: "csharp/types/Contract.Types.csproj", content: project("Types") },
    { path: "csharp/types/ContractTypes.cs", content: typesSource(c, namespace) + "\n" },
    { path: "csharp/provider/Contract.Provider.csproj", content: project("Provider") },
    {
      path: "csharp/provider/ContractProvider.cs",
      content: unitSource(namespace, "Provider", renderProvider(c)) + "\n",
    },
    { path: "csharp/client/Contract.Client.csproj", content: project("Client") },
    {
      path: "csharp/client/ContractClient.cs",
      content: unitSource(namespace, "Client", renderClient(c)) + "\n",
    },
  ]);
}
