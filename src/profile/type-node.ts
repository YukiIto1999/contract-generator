import {
  getTypeName,
  isArrayModelType,
  isStdNamespace,
  type Enum,
  type Scalar,
  type Type,
} from "@typespec/compiler";
import type { Declaration } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";
import { inspectType } from "./annotations.js";
import type { CompileState } from "./compile-state.js";
import { enumLiteral } from "./constants.js";
import { encodingsForScalar } from "./encodings.js";
import { checkLiteralDuplicates, literalOf } from "./literals.js";
import { modelNode } from "./model-type.js";
import { checkIntegerDomain } from "./numeric-bounds.js";
import { checkMemberNames, declareNode, pascalCase, publicName } from "./portable-names.js";
import {
  constraintsForScalar,
  hasInheritedMarker,
  integerKinds,
  nominalRole,
  rejectBytesPattern,
  scalarKind,
} from "./scalars.js";
import { stateKeys } from "./metadata.js";
import { unionNode } from "./union-type.js";

/**
 * Recursive graph normalization with early identity reservation
 * @param state - Normalization state owning the graph
 * @param type - Compiler-resolved nonnullable value type
 * @param path - Stable owner-based anonymous identity
 * @param name - Stable anonymous declaration name
 * @returns Stable normalized graph identity
 */
export function resolveNode(state: CompileState, type: Type, path: string, name: string): string {
  const previous = state.identities.get(type);
  if (previous) return previous;
  inspectType(state, type);
  const named = isNamedDeclaration(type);
  const id = named ? getTypeName(type) : `${path}$value`;
  state.identities.set(type, id);
  const exported =
    named && !("namespace" in type && type.namespace && isStdNamespace(type.namespace));
  buildNode(
    state,
    type,
    declareNode(state, type, id, named ? publicName(state, type) : name, exported),
  );
  return id;
}

/**
 * Whether a type is a declaration with a source name rather than an anonymous expression
 * @param type - Compiler-resolved value type
 * @returns Named scalar, model, union or enum, excluding the intrinsic array model
 */
function isNamedDeclaration(type: Type): boolean {
  const intrinsicArray =
    type.kind === "Model" &&
    type.name === "Array" &&
    type.namespace &&
    isStdNamespace(type.namespace) &&
    isArrayModelType(type);
  return (
    !intrinsicArray &&
    "name" in type &&
    typeof type.name === "string" &&
    !!type.name &&
    ["Scalar", "Model", "Union", "Enum"].includes(type.kind) &&
    !("expression" in type && type.expression)
  );
}

/**
 * Registration of the graph node for each kind of compiler type
 * @param state - Normalization state owning the graph
 * @param type - Compiler-resolved value type
 * @param declaration - Reserved graph identity
 */
function buildNode(state: CompileState, type: Type, declaration: Declaration): void {
  switch (type.kind) {
    case "Scalar":
      scalarNode(state, type, declaration);
      break;
    case "Model":
      modelNode(state, type, declaration);
      break;
    case "Union":
      unionNode(state, type, declaration);
      break;
    case "Enum":
      enumNode(state, type, declaration);
      break;
    case "String":
    case "Number":
    case "Boolean":
    case "EnumMember":
    case "StringTemplate":
    case "Intrinsic":
      literalNode(state, type, declaration);
      break;
    case "ModelProperty":
    case "Interface":
    case "TemplateParameter":
    case "TemplateParameterAccess":
    case "Namespace":
    case "Operation":
    case "StringTemplateSpan":
    case "Tuple":
    case "UnionVariant":
    case "FunctionType":
    case "Decorator":
    case "FunctionParameter":
    case "ScalarConstructor":
      state.issue("unsupported-type", type, `Unsupported public value kind ${type.kind}`);
      break;
  }
}

/**
 * Scalar node with its meaning, restrictions, nominal role and representations
 * @param state - Normalization state owning the graph
 * @param type - Resolved compiler scalar
 * @param declaration - Reserved graph identity
 */
function scalarNode(state: CompileState, type: Scalar, declaration: Declaration): void {
  const scalar = scalarKind(state, type);
  if (!scalar) return;
  const constraints = constraintsForScalar(state, type);
  if (integerKinds.includes(scalar)) checkIntegerDomain(constraints, type, state.issue);
  rejectBytesPattern(state, scalar, constraints, type);
  const role = nominalRole(state, type);
  if (role && role !== type) state.resolvers.node(role, getTypeName(role), publicName(state, role));
  state.types.set(declaration.id, {
    ...declaration,
    kind: "scalar",
    scalar,
    role: role ? getTypeName(role) : null,
    preserveLexical: hasInheritedMarker(state, type, stateKeys.preserveLexical),
    constraints,
    encodings: encodingsForScalar(state, type),
  });
}

/**
 * Closed enumeration node with canonically ordered members
 * @param state - Normalization state owning the graph
 * @param type - Resolved compiler enumeration
 * @param declaration - Reserved graph identity
 */
function enumNode(state: CompileState, type: Enum, declaration: Declaration): void {
  const members = [...type.members.values()]
    .sort((left, right) => compareText(left.name, right.name))
    .map((member) => {
      inspectType(state, member);
      return { name: pascalCase(member.name), value: enumLiteral(member) };
    });
  checkMemberNames(state, members, type);
  if (!members.length)
    state.issue("empty-domain", type, "An enumeration must contain at least one value");
  checkLiteralDuplicates(state, members, type);
  state.types.set(declaration.id, { ...declaration, kind: "enum", members });
}

/**
 * Single-value node for a literal type
 * @param state - Normalization state owning the graph
 * @param type - Resolved compiler literal type
 * @param declaration - Reserved graph identity
 */
function literalNode(state: CompileState, type: Type, declaration: Declaration): void {
  const value = literalOf(state, type);
  if (value) state.types.set(declaration.id, { ...declaration, kind: "literal", value });
  else state.issue("unsupported-type", type, `Unsupported public value type ${getTypeName(type)}`);
}
