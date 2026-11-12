import type { EmitContext, Program } from "@typespec/compiler";
import { Err, Ok, type Result } from "ts-results-es";
import type { CompilerOptions } from "./emitter-options.js";
import type {
  ContractModel,
  EmissionOptions,
  GeneratedFile,
  GenerationIssue,
  Target,
} from "./model/contract-model.js";
import { compileContract, reportIssues } from "./profile/compile-contract.js";
import { $decorators, $lib } from "./profile/library.js";
import { renderProjections } from "./projections/render-projections.js";
import {
  publishOutput,
  type PublicationFailure,
  type PublicationReceipt,
} from "./publication/publish-output.js";
import { renderCSharp } from "./targets/csharp/render-csharp.js";
import { renderRust } from "./targets/rust/render-rust.js";
import { renderTypeScript } from "./targets/typescript/render-typescript.js";

export { $decorators, $lib };

/** Language renderers sharing one private contract interpretation */
const renderers: Readonly<
  Record<
    Target,
    (
      model: ContractModel,
      options: EmissionOptions,
    ) => Result<readonly GeneratedFile[], readonly GenerationIssue[]>
  >
> = {
  typescript: renderTypeScript,
  csharp: renderCSharp,
  rust: renderRust,
};

/** Crate prefix derived from the portable contract name
 * @param name - PascalCase contract name
 * @returns Lowercase hyphenated prefix
 */
function cratePrefix(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/** Every selected language rendered from one model or the collected refusals
 * @param model - Complete validated contract
 * @param options - Resolved language integration
 * @returns Complete artifact set or every target issue
 */
function renderAll(
  model: ContractModel,
  options: EmissionOptions,
): Result<readonly GeneratedFile[], readonly GenerationIssue[]> {
  const files: GeneratedFile[] = [...renderProjections(model)];
  const issues: GenerationIssue[] = [];
  for (const target of [...options.targets].sort()) {
    const rendered = renderers[target](model, options);
    if (rendered.isErr()) issues.push(...rendered.error);
    else files.push(...rendered.value);
  }
  return issues.length > 0 ? Err(issues) : Ok(files);
}

/** Publication outcome surfaced through the compiler diagnostic pipeline
 * @param program - Compiler program receiving diagnostics
 * @param published - Result of the all-or-nothing publication
 */
function reportPublication(
  program: Program,
  published: Result<PublicationReceipt, PublicationFailure>,
): void {
  const target = program.getGlobalNamespaceType();
  if (published.isOk()) {
    if (published.value.retainedPaths.length > 0)
      $lib.reportDiagnostic(program, {
        code: "publication-cleanup",
        target,
        format: { paths: published.value.retainedPaths.join(", ") },
      });
    return;
  }
  const recovery =
    published.error.recoveryPaths.length === 0
      ? ""
      : "; recovery paths: " + published.error.recoveryPaths.join(", ");
  $lib.reportDiagnostic(program, {
    code: "publication-failure",
    target,
    format: { message: published.error.message + recovery, rule: published.error.code },
  });
}

/** Complete generation for every selected language or no publication
 * @param context - Compiler invocation with validated emitter options
 * @returns Completion after publication or diagnostic reporting
 */
export async function $onEmit(context: EmitContext<CompilerOptions>): Promise<void> {
  const program = context.program;
  if (program.compilerOptions.noEmit) return;
  const compiled = compileContract(program, context.options.namespace);
  if (compiled.isErr()) {
    reportIssues(program, compiled.error);
    return;
  }
  const model = compiled.value;
  const rendered = renderAll(model, {
    targets: context.options.targets,
    typescriptEffectModule: context.options["typescript-effect-module"],
    csharpNamespace: context.options["csharp-namespace"] ?? model.namespace,
    rustCratePrefix: context.options["rust-crate-prefix"] ?? cratePrefix(model.name),
  });
  if (rendered.isErr()) {
    reportIssues(program, rendered.error);
    return;
  }
  const check = context.options.check ?? false;
  reportPublication(program, await publishOutput(context.emitterOutputDir, rendered.value, check));
}
