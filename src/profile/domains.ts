import type { DiagnosticTarget } from "@typespec/compiler";
import type {
  Constraints,
  ContractType,
  Operation,
  Origin,
  TypeUse,
} from "../model/contract-model.js";
import { intersectConstraints } from "./constraint-intersection.js";
import { computeInhabited, hasValue, type DomainState } from "./domain-inhabitation.js";
import type { IssueSink } from "./issue-sink.js";
import { checkIntegerDomain } from "./numeric-bounds.js";
import { integerKinds } from "./scalars.js";

/** Number of Unicode code points in the canonical spelling of a UUID */
const uuidLength = 36;

/**
 * Finite value-domain preflight including recursive graph inhabitability
 * @param types - Complete normalized type graph
 * @param operations - Public operations with payload type uses
 * @param targetAt - Original compiler target for normalized source coordinates
 * @param issue - Source-addressed failure accumulator
 */
export function validateDomains(
  types: ReadonlyMap<string, ContractType>,
  operations: readonly Operation[],
  targetAt: (origin: Origin) => DiagnosticTarget,
  issue: IssueSink,
): void {
  const { references, roots } = collectReferences(types, operations);
  const state: DomainState = {
    types,
    roots,
    effective: new Map(),
    impossible: new Set(),
    inhabited: new Set(),
  };
  for (const reference of references) restrictReference(state, reference, targetAt, issue);
  computeInhabited(state);
  for (const reference of references) {
    if (!reference.nullable && !hasValue(state, reference) && !state.impossible.has(reference))
      issue(
        "empty-domain",
        targetAt(reference.origin),
        "The declared restrictions and required recursive fields admit no finite value",
        reference.id,
      );
  }
}

/**
 * Every value use in the graph and the unrestricted use of each node
 * @param types - Complete normalized type graph
 * @param operations - Public operations with payload type uses
 * @returns All uses and the unrestricted use of every node by identity
 */
function collectReferences(
  types: ReadonlyMap<string, ContractType>,
  operations: readonly Operation[],
): { readonly references: TypeUse[]; readonly roots: ReadonlyMap<string, TypeUse> } {
  const references: TypeUse[] = [];
  const roots = new Map<string, TypeUse>();
  for (const type of types.values()) {
    const root: TypeUse = { id: type.id, nullable: false, constraints: {}, origin: type.origin };
    roots.set(type.id, root);
    references.push(root, ...childUses(type));
  }
  for (const operation of operations) {
    for (const outcome of operation.outcomes) if (outcome.type) references.push(outcome.type);
  }
  return { references, roots };
}

/**
 * Value uses held directly by a node
 * @param type - Normalized node
 * @returns Field, element or variant uses; none for leaf nodes
 */
function childUses(type: ContractType): readonly TypeUse[] {
  switch (type.kind) {
    case "object":
      return type.fields.map((field) => field.type);
    case "array":
      return [type.element];
    case "union":
      return type.variants.map((variant) => variant.type);
    case "scalar":
    case "enum":
    case "literal":
      return [];
  }
}

/**
 * Effective restrictions of one use with empty domains diagnosed and the use marked impossible
 * @param state - Analysis state receiving the effective restrictions
 * @param reference - Declared value use
 * @param targetAt - Original compiler target for normalized source coordinates
 * @param issue - Source-addressed failure accumulator
 */
function restrictReference(
  state: DomainState,
  reference: TypeUse,
  targetAt: (origin: Origin) => DiagnosticTarget,
  issue: IssueSink,
): void {
  const type = state.types.get(reference.id);
  if (!type) {
    state.impossible.add(reference);
    return;
  }
  const target = targetAt(reference.origin);
  const collect: IssueSink = (code, source, reason, subject) => {
    state.impossible.add(reference);
    issue(code, source, reason, subject);
  };
  const constraints = intersectConstraints(
    "constraints" in type ? type.constraints : {},
    reference.constraints,
    target,
    collect,
  );
  state.effective.set(reference, constraints);
  if (type.kind === "scalar" && integerKinds.includes(type.scalar))
    checkIntegerDomain(constraints, target, collect);
  checkUuidLength(constraints, target, reference, collect);
}

/**
 * Length restrictions that exclude every UUID spelling
 * @param constraints - Effective restrictions of the use
 * @param target - Original compiler target of the use
 * @param reference - Declared value use
 * @param collect - Failure accumulator marking the use impossible
 */
function checkUuidLength(
  constraints: Constraints,
  target: DiagnosticTarget,
  reference: TypeUse,
  collect: IssueSink,
): void {
  if (
    constraints.format === "uuid" &&
    ((constraints.minLength ?? 0) > uuidLength || (constraints.maxLength ?? Infinity) < uuidLength)
  )
    collect(
      "empty-domain",
      target,
      `UUID spelling requires exactly ${uuidLength} Unicode code points`,
      reference.id,
    );
}
