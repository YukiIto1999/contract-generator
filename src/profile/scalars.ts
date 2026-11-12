import type { DiagnosticTarget, Model, Scalar } from "@typespec/compiler";
import type { Constraints, ScalarKind } from "../model/contract-model.js";
import { inspectType } from "./annotations.js";
import type { CompileState } from "./compile-state.js";
import { intersectConstraints } from "./constraint-intersection.js";
import { readConstraints } from "./constraints.js";
import { stateKeys } from "./metadata.js";
import { intrinsicRanges } from "./scalar-ranges.js";

/** Scalar meanings whose domain is a whole number */
export const integerKinds: readonly ScalarKind[] = ["integer", "int32", "int64", "uint64"];

/** TypeSpec intrinsic scalars and the contract meaning each one resolves to */
const intrinsicKinds: Readonly<Record<string, ScalarKind>> = {
  string: "string",
  boolean: "boolean",
  bytes: "bytes",
  int32: "int32",
  int64: "int64",
  uint64: "uint64",
  integer: "integer",
  decimal: "decimal",
  float32: "float32",
  float64: "float64",
  offsetDateTime: "offsetDateTime",
  utcDateTime: "utcDateTime",
  plainDate: "plainDate",
  plainTime: "plainTime",
  duration: "duration",
  int8: "integer",
  int16: "integer",
  uint8: "integer",
  uint16: "integer",
  uint32: "integer",
  safeint: "integer",
  numeric: "decimal",
};

/** TypeSpec intrinsic scalars whose semantic domain the profile cannot represent */
const unsupportedIntrinsics: Readonly<Record<string, true>> = {
  decimal128: true,
  float: true,
  url: true,
};

/**
 * Resolved scalar semantic identity independent of user-declared names
 * @param state - Normalization state receiving the failures
 * @param type - Scalar declaration with resolved base hierarchy
 * @param diagnose - Unsupported selected-domain reporting rather than ancestor encoding inspection
 * @returns Representable scalar meaning
 */
export function scalarKind(
  state: CompileState,
  type: Scalar,
  diagnose = true,
): ScalarKind | undefined {
  let current: Scalar | undefined = type;
  while (current) {
    inspectType(state, current);
    if (state.program.checker.isStdType(current)) {
      const kind = intrinsicKinds[current.name];
      if (kind) return kind;
      if (unsupportedIntrinsics[current.name]) {
        if (diagnose)
          state.issue(
            "unsupported-scalar",
            type,
            `The semantic domain of TypeSpec.${current.name} is not representable by this contract profile`,
          );
        return undefined;
      }
    }
    current = current.baseScalar;
  }
  if (diagnose)
    state.issue(
      "unsupported-scalar",
      type,
      "A public scalar must resolve to a supported TypeSpec intrinsic scalar",
    );
  return undefined;
}

/**
 * Complete inherited scalar restrictions without override-based weakening
 * @param state - Normalization state caching resolved restrictions
 * @param scalar - Scalar with resolved base hierarchy
 * @returns Effective exact restrictions
 */
export function constraintsForScalar(state: CompileState, scalar: Scalar): Constraints {
  const known = state.scalarConstraints.get(scalar);
  if (known) return known;
  inspectType(state, scalar);
  const inherited = scalar.baseScalar ? constraintsForScalar(state, scalar.baseScalar) : {};
  const intrinsic = state.program.checker.isStdType(scalar)
    ? (intrinsicRanges[scalar.name] ?? {})
    : {};
  const bounds = intersectConstraints(inherited, intrinsic, scalar, state.issue);
  const result = intersectConstraints(
    bounds,
    readConstraints(state.program, scalar, state.issue, state.exactNumber),
    scalar,
    state.issue,
  );
  state.scalarConstraints.set(scalar, result);
  return result;
}

/**
 * Inherited array cardinality restrictions including model-is provenance
 * @param state - Normalization state supplying the compiler program
 * @param model - Resolved array model
 * @returns Effective array restrictions
 */
export function constraintsForModel(state: CompileState, model: Model): Constraints {
  let constraints: Constraints = {};
  if (model.baseModel) constraints = constraintsForModel(state, model.baseModel);
  if (model.sourceModel)
    constraints = intersectConstraints(
      constraints,
      constraintsForModel(state, model.sourceModel),
      model,
      state.issue,
    );
  return intersectConstraints(
    constraints,
    readConstraints(state.program, model, state.issue, state.exactNumber),
    model,
    state.issue,
  );
}

/**
 * Inherited spelling-retention marker without inferred nominal roles
 * @param state - Normalization state supplying decorator state
 * @param scalar - Scalar with resolved hierarchy
 * @param key - Explicit marker state key
 * @returns Presence of the marker on the scalar or an ancestor
 */
export function hasInheritedMarker(state: CompileState, scalar: Scalar, key: symbol): boolean {
  let current: Scalar | undefined = scalar;
  while (current) {
    if (state.program.stateSet(key).has(current)) return true;
    current = current.baseScalar;
  }
  return false;
}

/**
 * Nearest scalar in the hierarchy that was declared as a separate nominal role
 * @param state - Normalization state supplying decorator state
 * @param scalar - Scalar with resolved hierarchy
 * @returns The scalar declaring the role, or undefined for an ordinary constrained scalar
 */
export function nominalRole(state: CompileState, scalar: Scalar): Scalar | undefined {
  let role: Scalar | undefined = scalar;
  while (role && !state.program.stateSet(stateKeys.distinct).has(role)) role = role.baseScalar;
  return role;
}

/**
 * Rejection of text patterns on byte sequences, which have no encoded-text interpretation here
 * @param state - Normalization state receiving the failure
 * @param scalar - Resolved scalar meaning
 * @param constraints - Restrictions that must not hold a pattern for bytes
 * @param target - Declaration responsible for the restrictions
 */
export function rejectBytesPattern(
  state: CompileState,
  scalar: ScalarKind,
  constraints: Constraints,
  target: DiagnosticTarget,
): void {
  if (scalar === "bytes" && constraints.pattern !== undefined)
    state.issue(
      "unsupported-bytes-pattern",
      target,
      "Byte patterns require an explicit encoded-text interpretation that is not part of this profile",
    );
}
