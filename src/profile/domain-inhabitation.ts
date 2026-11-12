import type { Constraints, ContractType, Literal, TypeUse } from "../model/contract-model.js";
import { checkConstantConstraints } from "./constant-constraints.js";

/** Intermediate results of the finite-value analysis over the complete graph */
export interface DomainState {
  /** Complete normalized type graph */
  readonly types: ReadonlyMap<string, ContractType>;
  /** Unrestricted use of every node, keyed by node identity */
  readonly roots: ReadonlyMap<string, TypeUse>;
  /** Complete effective restrictions of every use */
  readonly effective: Map<TypeUse, Constraints>;
  /** Uses whose own restrictions are already known to admit no value */
  readonly impossible: Set<TypeUse>;
  /** Nodes known to have a finite value */
  readonly inhabited: Set<string>;
}

/**
 * Least fixed point of the nodes that have a finite value
 * @param state - Analysis state whose inhabited set is extended in place
 */
export function computeInhabited(state: DomainState): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const type of state.types.values()) {
      if (state.inhabited.has(type.id)) continue;
      const root = state.roots.get(type.id)!;
      if (hasValue(state, root)) {
        state.inhabited.add(type.id);
        changed = true;
      }
    }
  }
}

/**
 * Membership of a use in the current least fixed point of finite value graphs
 * @param state - Analysis state with the nodes inhabited so far
 * @param reference - Declared value use with its complete effective restrictions
 * @returns Existence of a finite value without optional-field or null conflation
 */
export function hasValue(state: DomainState, reference: TypeUse): boolean {
  if (reference.nullable) return true;
  if (state.impossible.has(reference)) return false;
  const type = state.types.get(reference.id);
  if (!type) return false;
  const constraints = state.effective.get(reference) ?? reference.constraints;
  switch (type.kind) {
    case "scalar":
      return true;
    case "literal":
      return admitsLiteral(type.value, constraints);
    case "enum":
      return type.members.some((member) => admitsLiteral(member.value, constraints));
    case "object":
      return type.fields.every(
        (field) =>
          field.optional ||
          field.type.nullable ||
          (state.inhabited.has(field.type.id) && hasLocalDomain(state, field.type)),
      );
    case "array":
      return (
        (constraints.minItems ?? 0) === 0 ||
        type.element.nullable ||
        (state.inhabited.has(type.element.id) && hasLocalDomain(state, type.element))
      );
    case "union":
      return type.variants.some(
        (variant) => state.inhabited.has(variant.type.id) && hasLocalDomain(state, variant.type),
      );
  }
}

/**
 * Use-site restriction satisfiability after its referenced node is inhabited
 * @param state - Analysis state with the nodes inhabited so far
 * @param reference - Declared value use with local restrictions
 * @returns Nonempty local value domain without recursive graph descent
 */
function hasLocalDomain(state: DomainState, reference: TypeUse): boolean {
  if (reference.nullable) return true;
  if (state.impossible.has(reference)) return false;
  const type = state.types.get(reference.id);
  if (!type) return false;
  const constraints = state.effective.get(reference) ?? reference.constraints;
  switch (type.kind) {
    case "literal":
      return admitsLiteral(type.value, constraints);
    case "enum":
      return type.members.some((member) => admitsLiteral(member.value, constraints));
    case "array":
      return (
        (constraints.minItems ?? 0) === 0 ||
        type.element.nullable ||
        state.inhabited.has(type.element.id)
      );
    case "scalar":
    case "object":
    case "union":
      return true;
  }
}

/**
 * Whether a declared literal satisfies the restrictions of its use
 * @param value - Declared literal
 * @param constraints - Effective restrictions of the use
 * @returns Absence of any restriction violation
 */
function admitsLiteral(value: Literal, constraints: Constraints): boolean {
  return checkConstantConstraints(value, constraints, "").length === 0;
}
