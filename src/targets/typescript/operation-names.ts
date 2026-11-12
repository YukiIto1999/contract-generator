import type { Operation } from "../../model/contract-model.js";

/**
 * PascalCase stem of an operation for derived declaration names
 * @param operation - Resolved operation
 * @returns Operation name with an upper-case initial
 */
export function operationStem(operation: Operation): string {
  return operation.name.charAt(0).toUpperCase() + operation.name.slice(1);
}

/**
 * Public contract module names an operation declares
 * @param operation - Resolved operation
 * @returns Acceptance function, outcome codecs and the three operation types
 */
export function operationPublicNames(operation: Operation): readonly string[] {
  const stem = operationStem(operation);
  return [
    `accept${stem}`,
    `${operation.name}Outcomes`,
    `${stem}AcceptedInput`,
    `${stem}Success`,
    `${stem}Rejection`,
  ];
}
