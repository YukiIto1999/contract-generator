import {
  getTypeName,
  type Namespace,
  type Operation as CompilerOperation,
  type Program,
} from "@typespec/compiler";
import { Err, Ok, type Result } from "ts-results-es";
import type { ContractModel, GenerationIssue, Operation } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";
import { inspectType } from "./annotations.js";
import { CompileState } from "./compile-state.js";
import { normalizeFieldDefaults, validatePendingDefaults } from "./default-pipeline.js";
import { validateDomains } from "./domains.js";
import { sortIssuesByLocation, sortIssuesCanonically } from "./issue-ordering.js";
import { visitNamespace } from "./namespace-walk.js";
import { operationOf } from "./operations.js";
import { checkOperationIdentities } from "./operation-identity.js";
import { pascalCase } from "./portable-names.js";
import { resolveNode } from "./type-node.js";
import { useType } from "./type-use.js";

/**
 * Normalization state whose recursive resolution entry points are bound to the resolvers
 * @param program - Fully checked compiler program
 * @param namespace - Resolved selected namespace when available
 * @returns Fresh state isolated to one compile invocation
 */
export function createCompileState(
  program: Program,
  namespace: Namespace | undefined,
): CompileState {
  return new CompileState(program, namespace, (state) => ({
    use: (source, path, name, target, property) =>
      useType(state, source, path, name, target, property),
    node: (type, path, name) => resolveNode(state, type, path, name),
  }));
}

/**
 * Complete selected namespace interpretation before returning a model
 * @param state - Normalization state holding any failures reported so far
 * @returns Fully normalized contract or deterministically ordered failures
 */
export function compileNamespace(
  state: CompileState,
): Result<ContractModel, readonly GenerationIssue[]> {
  if (!state.namespace) return Err(state.issues);
  if (state.issues.length) {
    sortIssuesByLocation(state.issues);
    return Err(state.issues);
  }
  registerIndexerDecorator(state);
  const operations = normalizeOperations(state, state.namespace);
  if (
    state.issues.some(
      (issue) => issue.code === "invalid-pattern" || issue.code === "unsupported-pattern",
    )
  ) {
    sortIssuesCanonically(state.issues);
    return Err(state.issues);
  }
  normalizeFieldDefaults(state);
  validatePendingDefaults(state);
  validateDomains(state.types, operations, (origin) => state.targetAt(origin), state.issue);
  checkOperationIdentities(state, operations);
  sortIssuesCanonically(state.issues);
  if (state.issues.length) return Err(state.issues);
  return Ok({
    namespace: state.namespaceName,
    name: pascalCase(state.namespaceName.split(".").at(-1) ?? state.namespaceName),
    types: [...state.types.values()].sort((left, right) => compareText(left.id, right.id)),
    operations: operations.sort((left, right) => compareText(left.id, right.id)),
  });
}

/**
 * Compiler-internal indexer decorator accepted without a declaration
 * @param state - Normalization state holding the accepted decorator implementations
 */
function registerIndexerDecorator(state: CompileState): void {
  const indexer = state.program.checker
    .getStdType("Array")
    .decorators.find((application) => application.decorator.name === "indexerDecorator");
  if (indexer) state.intrinsicDecorators.add(indexer.decorator);
}

/**
 * Type graph and public operations of the selected namespace
 * @param state - Normalization state owning the graph
 * @param namespace - Selected namespace
 * @returns Normalized operations in stable declaration-name order
 */
function normalizeOperations(state: CompileState, namespace: Namespace): Operation[] {
  let ancestor = namespace.namespace;
  while (ancestor) {
    inspectType(state, ancestor);
    ancestor = ancestor.namespace;
  }
  const operations: CompilerOperation[] = [];
  visitNamespace(state, namespace, operations);
  return operations
    .sort((left, right) => compareText(getTypeName(left), getTypeName(right)))
    .map((operation) => operationOf(state, operation));
}
