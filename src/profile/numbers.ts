import { Numeric, type DiagnosticTarget, type Program } from "@typespec/compiler";
import { SyntaxKind, visitChildren, type Node } from "@typespec/compiler/ast";
import { compareText } from "../model/ordering.js";
import type { IssueSink } from "./issue-sink.js";

/**
 * Exact numeric spelling recovery from compiler-owned syntax provenance
 * @param expression - Original compiler expression when the numeric value was written directly
 * @param resolved - Compiler-resolved numeric spelling for references
 * @param target - Declaration responsible for an ambiguous reference
 * @returns Exact finite numeric spelling
 */
export type ExactNumber = (
  expression: Node | undefined,
  resolved: string,
  target: DiagnosticTarget,
) => string;

/** JSON-compatible numeric spelling retained without normalization */
const jsonNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * Numeric reference resolution guarded against binary64-keyed literal type reuse
 * @param program - Fully parsed and checked compiler program
 * @param issue - Source-addressed failure accumulator
 * @returns Exact spelling resolver for one profile compilation
 */
export function createExactNumber(program: Program, issue: IssueSink): ExactNumber {
  const values = new Map<number, Map<string, string>>();
  for (const script of program.sourceFiles.values()) collect(script);
  return (expression, resolved, target) => {
    if (expression?.kind === SyntaxKind.NumericLiteral) return spelling(expression.valueAsString);
    const exact = Numeric(resolved).toString();
    const candidates = values.get(Number(exact));
    if (candidates && candidates.size > 1) {
      issue(
        "ambiguous-numeric-reference",
        target,
        `The installed compiler resolves this numeric reference through a literal cache shared by ${[...candidates.values()].sort(compareText).join(" and ")}; write the numeric literal at this declaration`,
      );
    }
    return spelling(resolved);
  };

  /**
   * Source numerals grouped by the compiler literal-cache key
   * @param node - Parsed source subtree
   */
  function collect(node: Node): void {
    if (node.kind === SyntaxKind.NumericLiteral) {
      const exact = Numeric(node.valueAsString).toString();
      const group = values.get(node.value) ?? new Map<string, string>();
      group.set(exact, node.valueAsString);
      values.set(node.value, group);
    }
    visitChildren(node, (child) => {
      collect(child);
    });
  }
}

/**
 * Source numeral spelling in JSON-compatible form
 * @param text - Compiler-retained numeric spelling
 * @returns Original decimal spelling or its exact decimal normalization
 */
function spelling(text: string): string {
  return jsonNumber.test(text) ? text : Numeric(text).toString();
}
