import type { ContractModel, Constraints } from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { prepareDotNetPattern } from "../../model/patterns/compiled-pattern.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, quote } from "./naming.js";

/** Options of every generated matcher: culture-independent, and linear in the length of the text */
const matcherOptions = "RegexOptions.CultureInvariant | RegexOptions.NonBacktracking";

/**
 * Distinct patterns that a contract applies to text
 * @param model - Normalized contract
 * @returns Original pattern sources in code-unit order, so that the names derived from them never depend on declaration order
 */
export function patternSources(model: ContractModel): readonly string[] {
  const sources = new Set<string>();
  const add = ({ pattern }: Constraints): void => {
    if (pattern !== undefined) sources.add(pattern);
  };
  for (const node of model.types) {
    if (node.kind === "scalar") add(node.constraints);
    else if (node.kind === "object") for (const field of node.fields) add(field.type.constraints);
    else if (node.kind === "array") add(node.element.constraints);
    else if (node.kind === "union")
      for (const variant of node.variants) add(variant.type.constraints);
  }
  for (const operation of model.operations)
    for (const outcome of operation.outcomes) if (outcome.type) add(outcome.type.constraints);
  return [...sources].toSorted(compareText);
}

/**
 * Reason why C# cannot keep a pattern that a declaration carries
 * @param c - Target context
 * @param id - Declaration or use that holds the pattern
 * @param pattern - Original pattern source, if the declaration has one
 * @returns No reason when the pattern runs, otherwise why the matcher cannot be generated
 */
export function patternReason(
  c: CSharpContext,
  id: string,
  pattern: string | undefined,
): string | undefined {
  if (pattern === undefined) return undefined;
  const node = c.nodes.get(id);
  if (node?.kind !== "scalar" || c.storage(node) !== "string")
    return "A pattern constrains text, and this declaration does not hold text";
  const prepared = prepareDotNetPattern(pattern);
  return prepared.isErr() ? prepared.error.reason : undefined;
}

/**
 * Expression that passes the matcher of a pattern to the text check
 * @param c - Target context
 * @param pattern - Original pattern source, if the restriction has one
 * @returns The shared matcher, or null without a pattern
 */
export function patternReference(c: CSharpContext, pattern: string | undefined): string {
  return pattern === undefined ? "null" : `Wire.${c.patternNames.get(pattern)!}`;
}

/**
 * Compiled matchers of every pattern of the contract
 * @param c - Target context
 * @returns One shared matcher per distinct pattern, or nothing when the contract has none
 * @throws {@link Error} A pattern that the declarations check had not rejected
 */
export function renderPatterns(c: CSharpContext): string {
  if (c.patternNames.size === 0) return "";
  return lines(
    doc("Declared patterns of the contract, each compiled once"),
    "internal static partial class Wire",
    "{",
    ...[...c.patternNames].map(([source, name], index) =>
      lines(
        doc(`Linear-time matcher of the declared pattern ${index}`),
        `internal static readonly Regex ${name} = new(${quote(prepareDotNetPattern(source).unwrap().source)}, ${matcherOptions});`,
      ),
    ),
    "}",
  );
}
