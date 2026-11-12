import {
  getTypeName,
  isTemplateDeclaration,
  isVoidType,
  type Interface,
  type Namespace,
  type Operation as CompilerOperation,
  type Union,
} from "@typespec/compiler";
import { compareText } from "../model/ordering.js";
import { inspectType } from "./annotations.js";
import type { CompileState } from "./compile-state.js";
import { pascalCase, publicName } from "./portable-names.js";

/**
 * Namespace traversal with canonical source-independent ordering
 * @param state - Normalization state owning the graph
 * @param namespace - Selected namespace or one of its descendants
 * @param operations - Public operation accumulator
 */
export function visitNamespace(
  state: CompileState,
  namespace: Namespace,
  operations: CompilerOperation[],
): void {
  inspectType(state, namespace);
  const declarations = [
    ...namespace.scalars.values(),
    ...namespace.models.values(),
    ...namespace.enums.values(),
    ...namespace.unions.values(),
  ].sort((left, right) => compareText(getTypeName(left), getTypeName(right)));
  for (const type of declarations) {
    if (type.kind !== "Enum" && isTemplateDeclaration(type)) continue;
    if (type.kind === "Union" && state.isOutcomes(type)) visitOutcomes(state, type);
    else state.resolvers.use(type, getTypeName(type), publicName(state, type), type);
  }
  collectOperations(namespace.operations.values(), operations);
  const interfaces = [...namespace.interfaces.values()].sort((left, right) =>
    compareText(left.name, right.name),
  );
  for (const declaration of interfaces) visitInterface(state, declaration, operations);
  const children = [...namespace.namespaces.values()].sort((left, right) =>
    compareText(left.name, right.name),
  );
  for (const child of children) visitNamespace(state, child, operations);
}

/**
 * Payload nodes of the result paths of an outcomes union
 * @param state - Normalization state owning the graph
 * @param type - Union marked as an operation outcomes declaration
 */
function visitOutcomes(state: CompileState, type: Union): void {
  inspectType(state, type);
  const variants = [...type.variants.values()].sort((left, right) =>
    compareText(String(left.name), String(right.name)),
  );
  for (const variant of variants) {
    inspectType(state, variant);
    if (!isVoidType(variant.type))
      state.resolvers.use(
        variant.type,
        `${getTypeName(type)}$${String(variant.name)}`,
        `${publicName(state, type)}${pascalCase(String(variant.name))}`,
        variant,
      );
  }
}

/**
 * Operations of a non-template interface
 * @param state - Normalization state recording inspected declarations
 * @param declaration - Interface declared in the namespace
 * @param operations - Public operation accumulator
 */
function visitInterface(
  state: CompileState,
  declaration: Interface,
  operations: CompilerOperation[],
): void {
  if (isTemplateDeclaration(declaration)) return;
  inspectType(state, declaration);
  collectOperations(declaration.operations.values(), operations);
}

/**
 * Non-template operations appended to the accumulator
 * @param candidates - Operations declared by a namespace or interface
 * @param operations - Public operation accumulator
 */
function collectOperations(
  candidates: Iterable<CompilerOperation>,
  operations: CompilerOperation[],
): void {
  for (const operation of candidates)
    if (!isTemplateDeclaration(operation)) operations.push(operation);
}
