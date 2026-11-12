import { NoTarget, getNamespaceFullName, type Namespace, type Program } from "@typespec/compiler";
import { Err, type Result } from "ts-results-es";
import type { ContractModel, GenerationIssue } from "../model/contract-model.js";
import { compileNamespace, createCompileState } from "./contract-compiler.js";
import { $lib } from "./library.js";
import { relativeSourcePath } from "./source-origin.js";

/**
 * Complete compiler-owned source interpretation for one public namespace
 * @param program - TypeSpec program after semantic checking
 * @param namespace - Selected fully qualified namespace or its resolved compiler type
 * @returns Complete private model or source-addressed generation failures
 */
export function compileContract(
  program: Program,
  namespace: string | Namespace,
): Result<ContractModel, readonly GenerationIssue[]> {
  const resolved = typeof namespace === "string" ? resolveNamespace(program, namespace) : namespace;
  const state = createCompileState(program, resolved);
  for (const diagnostic of program.diagnostics) {
    if (diagnostic.severity === "error") state.addDiagnostic(diagnostic);
  }
  if (!resolved) {
    state.issue(
      "unknown-namespace",
      program.getGlobalNamespaceType(),
      `No public namespace named ${JSON.stringify(namespace)}`,
      typeof namespace === "string" ? namespace : getNamespaceFullName(namespace),
    );
    return Err(state.issues);
  }
  return compileNamespace(state);
}

/**
 * Generation failures reported through the compiler diagnostic pipeline
 * @param program - Compiler program retaining original source files
 * @param issues - Relative source-addressed failures from profile or target interpretation
 */
export function reportIssues(program: Program, issues: readonly GenerationIssue[]): void {
  const sources = [...program.sourceFiles.values()];
  for (const issue of issues) {
    const source = sources.find(
      (candidate) => relativeSourcePath(program, candidate.file.path) === issue.origin.file,
    );
    $lib.reportDiagnostic(program, {
      code: "generation-issue",
      target: source
        ? { file: source.file, pos: issue.origin.start, end: issue.origin.end }
        : NoTarget,
      format: {
        target: issue.target,
        subject: issue.subject,
        reason: issue.reason,
        rule: issue.code,
      },
    });
  }
}

/**
 * Exact selected namespace resolution without source-text interpretation
 * @param program - Fully checked compiler program
 * @param name - Fully qualified namespace name
 * @returns Resolved namespace for a nonempty existing namespace path
 */
function resolveNamespace(program: Program, name: string): Namespace | undefined {
  if (!name || name.split(".").some((part) => !part)) return undefined;
  let current = program.getGlobalNamespaceType();
  for (const part of name.split(".")) {
    const child = current.namespaces.get(part);
    if (!child) return undefined;
    current = child;
  }
  return current;
}
