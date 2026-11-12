import {
  isNeverType,
  isNullType,
  type DiagnosticTarget,
  type Expression,
  type Type,
  type Union,
  type UnionVariant,
} from "@typespec/compiler";
import { SyntaxKind, type Node } from "@typespec/compiler/ast";
import type { Literal } from "../model/contract-model.js";
import type { CompileState } from "./compile-state.js";
import { enumLiteral } from "./constants.js";

/**
 * Exact primitive literal interpretation from the resolved compiler graph
 * @param state - Normalization state supplying exact numeric spelling
 * @param type - Resolved primitive candidate
 * @param expression - Original compiler expression retaining exact numeric syntax
 * @returns Exact primitive value when the type has one permitted value
 */
export function literalOf(state: CompileState, type: Type, expression?: Node): Literal | undefined {
  switch (type.kind) {
    case "String":
      return { kind: "string", value: type.value };
    case "Number":
      return {
        kind: "number",
        text: state.exactNumber(expression, type.valueAsString, expression ?? type),
      };
    case "Boolean":
      return { kind: "boolean", value: type.value };
    case "EnumMember":
      return enumLiteral(type);
    case "StringTemplate":
      return type.stringValue === undefined
        ? undefined
        : { kind: "string", value: type.stringValue };
    case "Intrinsic":
      return isNullType(type) ? { kind: "null" } : undefined;
    case "Model":
    case "ModelProperty":
    case "Scalar":
    case "Interface":
    case "Enum":
    case "TemplateParameter":
    case "TemplateParameterAccess":
    case "Namespace":
    case "Operation":
    case "StringTemplateSpan":
    case "Tuple":
    case "Union":
    case "UnionVariant":
    case "FunctionType":
    case "Decorator":
    case "FunctionParameter":
    case "ScalarConstructor":
      return undefined;
  }
}

/**
 * Exact literal case uniqueness without binary64 key collisions
 * @param state - Normalization state receiving the failures
 * @param members - Closed enumeration cases
 * @param target - Containing declaration for diagnostics
 */
export function checkLiteralDuplicates(
  state: CompileState,
  members: readonly { readonly value: Literal }[],
  target: DiagnosticTarget,
): void {
  const values = new Set<string>();
  for (const { value } of members) {
    const key = literalKey(value);
    if (values.has(key))
      state.issue("duplicate-literal", target, `Multiple cases have the same ${value.kind} value`);
    values.add(key);
  }
}

/**
 * Identity of a literal that keeps numeric spelling apart from binary64 value
 * @param value - Closed enumeration case value
 * @returns Key equal exactly for equal literals of one kind
 */
function literalKey(value: Literal): string {
  switch (value.kind) {
    case "number":
      return `number:${value.text}`;
    case "null":
      return "null";
    case "string":
    case "boolean":
      return `${value.kind}:${JSON.stringify(value.value)}`;
  }
}

/**
 * Compiler source expressions aligned with resolved flattened union variants
 * @param state - Normalization state supplying compiler type resolution
 * @param type - Fully checked keyword or expression union
 * @returns Original numeric provenance without reconstructing source syntax
 */
export function unionExpressions(
  state: CompileState,
  type: Union,
): ReadonlyMap<UnionVariant, Expression> {
  const expressions = new Map<UnionVariant, Expression>();
  const variants = [...type.variants.values()];
  if (type.node?.kind !== SyntaxKind.UnionExpression) {
    for (const variant of variants) if (variant.node) expressions.set(variant, variant.node.value);
    return expressions;
  }
  let index = 0;
  for (const option of type.node.options) {
    const resolved = state.program.checker.getTypeForNode(option);
    if (isNeverType(resolved)) continue;
    if (resolved.kind === "Union" && resolved.node?.kind === SyntaxKind.UnionExpression) {
      const nested = unionExpressions(state, resolved);
      for (const variant of resolved.variants.values()) {
        const expression = nested.get(variant);
        const destination = variants[index++];
        if (expression && destination) expressions.set(destination, expression);
      }
    } else {
      const destination = variants[index++];
      if (destination) expressions.set(destination, option);
    }
  }
  return expressions;
}
