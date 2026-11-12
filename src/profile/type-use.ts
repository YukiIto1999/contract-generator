import {
  getDiscriminatedUnion,
  isNullType,
  type DiagnosticTarget,
  type ModelProperty,
  type NumericLiteral,
  type Type,
} from "@typespec/compiler";
import { getNodeForTarget, type Node } from "@typespec/compiler/ast";
import type {
  Binding,
  Constraints,
  ContractType,
  Encoding,
  TypeUse,
} from "../model/contract-model.js";
import { inspectType } from "./annotations.js";
import type { CompileState } from "./compile-state.js";
import { intersectConstraints } from "./constraint-intersection.js";
import { readConstraints } from "./constraints.js";
import { encodingOverrides } from "./encodings.js";
import { checkIntegerDomain } from "./numeric-bounds.js";
import { declareNode } from "./portable-names.js";
import { integerKinds, rejectBytesPattern } from "./scalars.js";

/**
 * Resolved type use with nullability independent of property presence
 * @param state - Normalization state owning the graph
 * @param source - Resolved compiler type at the use site
 * @param path - Stable owner-based identity for anonymous types
 * @param name - Stable target name for anonymous types
 * @param target - Declaration responsible for use-site diagnostics
 * @param property - Optional source property owning local restrictions
 * @returns Compiler-independent graph reference and use-site restrictions
 */
export function useType(
  state: CompileState,
  source: Type,
  path: string,
  name: string,
  target: DiagnosticTarget,
  property?: ModelProperty,
): TypeUse {
  inspectType(state, source);
  const { type, nullable } = unwrapNullable(state, source, target);
  const constraints = property
    ? readConstraints(state.program, property, state.issue, state.exactNumber)
    : {};
  const id =
    type.kind === "Number"
      ? numberLiteralNode(state, type, path, name, target, property)
      : state.resolvers.node(type, path, name);
  const node = state.types.get(id);
  checkUseRestrictions(state, node, constraints, target);
  const encodings = property ? propertyEncodings(state, property, node) : undefined;
  return {
    id,
    nullable,
    constraints,
    origin: state.origin(target),
    ...(encodings ? { encodings } : {}),
  };
}

/**
 * Nullability and single-value unions removed from a use site
 * @param state - Normalization state receiving the failures
 * @param source - Resolved compiler type at the use site
 * @param target - Declaration responsible for use-site diagnostics
 * @returns The value type and whether null is permitted in addition to it
 */
function unwrapNullable(
  state: CompileState,
  source: Type,
  target: DiagnosticTarget,
): { readonly type: Type; readonly nullable: boolean } {
  let type = source;
  let nullable = isNullType(type);
  const visited = new Set<Type>();
  while (type.kind === "Union" && !visited.has(type)) {
    visited.add(type);
    if (state.isOutcomes(type))
      state.issue(
        "outcomes-as-payload",
        target,
        "An @outcomes union cannot be used as a payload value",
      );
    if (getDiscriminatedUnion(state.program, type)[0]) break;
    const variants = [...type.variants.values()];
    for (const variant of variants) inspectType(state, variant);
    const values = variants.filter((variant) => !isNullType(variant.type));
    nullable ||= values.length !== variants.length;
    if (values.length !== 1 || (type.name && values.length === variants.length)) break;
    type = values[0]!.type;
    inspectType(state, type);
  }
  return { type, nullable };
}

/**
 * Compiler source expression behind a use site, retaining the written numeral
 * @param target - Declaration responsible for the use
 * @returns Original expression when the target is a source node carrier
 */
function sourceExpression(target: DiagnosticTarget): Node | undefined {
  const carrier =
    "kind" in target || "entityKind" in target || "flags" in target || "templateMapper" in target
      ? getNodeForTarget(target)
      : undefined;
  return carrier && "value" in carrier && typeof carrier.value === "object"
    ? carrier.value
    : undefined;
}

/**
 * Anonymous literal node for a numeric literal type with its exact spelling
 * @param state - Normalization state owning the graph
 * @param type - Numeric literal type
 * @param path - Stable owner-based identity
 * @param name - Stable anonymous declaration name
 * @param target - Declaration responsible for the use
 * @param property - Optional source property owning the use
 * @returns Identity of the registered literal node
 */
function numberLiteralNode(
  state: CompileState,
  type: NumericLiteral,
  path: string,
  name: string,
  target: DiagnosticTarget,
  property: ModelProperty | undefined,
): string {
  const id = `${path}$value`;
  state.types.set(id, {
    ...declareNode(state, property ?? type, id, name, false),
    origin: state.origin(target),
    kind: "literal",
    value: {
      kind: "number",
      text: state.exactNumber(sourceExpression(target), type.valueAsString, target),
    },
  });
  return id;
}

/**
 * Use-site restriction checks against the referenced node
 * @param state - Normalization state receiving the failures
 * @param node - Referenced graph node when resolved
 * @param constraints - Restrictions declared at the use site
 * @param target - Declaration responsible for the use
 */
function checkUseRestrictions(
  state: CompileState,
  node: ContractType | undefined,
  constraints: Constraints,
  target: DiagnosticTarget,
): void {
  const effective = intersectConstraints(
    node && "constraints" in node ? node.constraints : {},
    constraints,
    target,
    state.issue,
  );
  if (node?.kind !== "scalar") return;
  if (integerKinds.includes(node.scalar)) checkIntegerDomain(effective, target, state.issue);
  rejectBytesPattern(state, node.scalar, constraints, target);
}

/**
 * Binding encodings declared on the property that uses a scalar
 * @param state - Normalization state receiving the failures
 * @param property - Source property carrying the declarations
 * @param node - Referenced graph node when resolved
 * @returns Declared overrides, or undefined when none exist
 */
function propertyEncodings(
  state: CompileState,
  property: ModelProperty,
  node: ContractType | undefined,
): Readonly<Partial<Record<Binding, Encoding>>> | undefined {
  inspectType(state, property);
  const overrides = encodingOverrides(
    state,
    property,
    node?.kind === "scalar" ? node.scalar : undefined,
  );
  return Object.keys(overrides).length ? overrides : undefined;
}
