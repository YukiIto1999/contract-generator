import type { Bound, Constraints } from "../../model/contract-model.js";
import { preparePattern } from "../../model/patterns/compiled-pattern.js";
import { declareConstant, type ContractContext } from "./contract-context.js";
import { camel, quote } from "./source-text.js";

/** Value expressions a constraint check observes */
export interface CheckSubject {
  /** Expression of the value's text for length, format and pattern rules */
  readonly text: string;
  /** Expression of the value's elements for cardinality rules */
  readonly items: string;
}

/** Numeric boundaries of a declaration or reference */
export interface NumericLimits {
  /** Lower boundary */
  readonly minimum?: Bound | undefined;
  /** Upper boundary */
  readonly maximum?: Bound | undefined;
}

/**
 * Boundary construction expression
 * @param edge - Resolved boundary
 * @returns Source of the runtime boundary
 */
function boundSource(edge: Bound): string {
  return `bound(${quote(edge.value)}, ${edge.exclusive})`;
}

/**
 * Length, cardinality, format and pattern checks as direct statements
 * @param context - Generation state
 * @param owner - Readable owner stem for derived constant names
 * @param constraints - Normalized restrictions
 * @param subject - Observed value expressions
 * @returns Check statements reporting violations at the current path
 */
export function textChecks(
  context: ContractContext,
  owner: string,
  constraints: Constraints,
  subject: CheckSubject,
): string[] {
  const statements: string[] = [];
  if (constraints.pattern !== undefined)
    statements.push("{", "const patternStart = state.violations.length;");
  const reject = (rule: string): string => `invalid(state, path, ${quote(rule)});`;
  if (constraints.minLength !== undefined)
    statements.push(
      `if (codePointLength(${subject.text}) < ${constraints.minLength}) ${reject("minLength")}`,
    );
  if (constraints.maxLength !== undefined)
    statements.push(
      `if (codePointLength(${subject.text}) > ${constraints.maxLength}) ${reject("maxLength")}`,
    );
  if (constraints.minItems !== undefined)
    statements.push(`if (${subject.items}.length < ${constraints.minItems}) ${reject("minItems")}`);
  if (constraints.maxItems !== undefined)
    statements.push(`if (${subject.items}.length > ${constraints.maxItems}) ${reject("maxItems")}`);
  if (constraints.format === "uuid")
    statements.push(`if (!isUuid(${subject.text})) ${reject("format")}`);
  if (constraints.pattern !== undefined) {
    const pattern = patternConstant(context, owner, constraints.pattern);
    statements.push(
      `if (state.violations.length === patternStart && !${pattern}.test(${subject.text})) ${reject("format")}`,
      "}",
    );
  }
  return statements;
}

/**
 * One private compiled constant per original pattern in this module
 * @param context - Generation state
 * @param owner - Readable declaration stem
 * @param source - Preflighted original pattern
 * @returns Private matcher name
 * @throws {@link Error} Pattern escaping generation preflight
 */
function patternConstant(context: ContractContext, owner: string, source: string): string {
  const previous = context.patterns.get(source);
  if (previous !== undefined) return previous;
  const prepared = preparePattern(source).unwrap();
  const name = declareConstant(
    context,
    `${camel(owner)}Pattern`,
    `Declared pattern of ${owner}`,
    `${context.patternEngine}.compile(${quote(prepared.source)})`,
  );
  context.patterns.set(source, name);
  return name;
}

/**
 * Exact numeric boundary check as one statement
 * @param context - Generation state
 * @param owner - Readable owner stem for the derived constant name
 * @param limits - Declared boundaries
 * @param text - Expression of the exact numeric token
 * @returns Check statements, empty when no boundary is declared
 */
export function rangeChecks(
  context: ContractContext,
  owner: string,
  limits: NumericLimits,
  text: string,
): string[] {
  const entries = [
    ...(limits.minimum === undefined ? [] : [`minimum: ${boundSource(limits.minimum)}`]),
    ...(limits.maximum === undefined ? [] : [`maximum: ${boundSource(limits.maximum)}`]),
  ];
  if (entries.length === 0) return [];
  const range = declareConstant(
    context,
    `${camel(owner)}Range`,
    `Declared numeric boundaries of ${owner}`,
    `{ ${entries.join(", ")} }`,
    "NumericRange",
  );
  return [`checkRange(state, path, ${text}, ${range});`];
}
