import type { CompileState } from "./compile-state.js";
import { validateDefaultExpansion } from "./default-expansion.js";
import { normalizeDefault } from "./default-normalization.js";
import { validateDefault } from "./default-validation.js";

/**
 * Canonical logical default on every field that declares one
 * @param state - Normalization state whose graph is rewritten in place
 */
export function normalizeFieldDefaults(state: CompileState): void {
  for (const type of state.types.values()) {
    if (type.kind !== "object" || !type.fields.some((field) => field.default !== undefined))
      continue;
    const fields = type.fields.map((field) =>
      field.default === undefined
        ? field
        : { ...field, default: normalizeDefault(field.default, field.type, state.types) },
    );
    state.types.set(type.id, { ...type, fields });
  }
}

/**
 * Every declared default checked against its field once the graph is complete
 * @param state - Normalization state holding the pending defaults
 */
export function validatePendingDefaults(state: CompileState): void {
  for (const entry of state.defaults) {
    const value = normalizeDefault(entry.value, entry.use, state.types);
    validateDefault(value, entry.use, state.types, entry.target, state.issue);
    validateDefaultExpansion(value, entry.use, state.types, entry.target, state.issue);
  }
}
