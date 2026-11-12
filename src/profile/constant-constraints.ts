import type { Constant, Constraints } from "../model/contract-model.js";
import { compareNumbers } from "./numeric-bounds.js";

/** Canonical textual form of a UUID with either letter case */
const uuidText = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Scalar and collection restrictions applied to an exact constant
 * @param value - Candidate constant
 * @param constraints - Effective inherited and use-site restrictions
 * @param path - Source constant property path
 * @returns Applicable restriction violations
 */
export function checkConstantConstraints(
  value: Constant,
  constraints: Constraints,
  path: string,
): string[] {
  switch (value.kind) {
    case "number":
      return checkNumber(value.text, constraints, path);
    case "string":
      return checkString(value.value, constraints, path);
    case "array":
      return checkItems(value.items.length, constraints, path);
    case "boolean":
    case "null":
    case "object":
      return [];
  }
}

/**
 * Numeric boundary violations of a number constant
 * @param text - Exact numeric spelling
 * @param constraints - Effective restrictions
 * @param path - Source constant property path
 * @returns Violations of the minimum and maximum
 */
function checkNumber(text: string, constraints: Constraints, path: string): string[] {
  const reasons: string[] = [];
  const { minimum, maximum } = constraints;
  if (minimum !== undefined) {
    const comparison = compareNumbers(text, minimum.value);
    if (comparison < 0 || (comparison === 0 && minimum.exclusive))
      reasons.push(`${path}: default violates minimum`);
  }
  if (maximum !== undefined) {
    const comparison = compareNumbers(text, maximum.value);
    if (comparison > 0 || (comparison === 0 && maximum.exclusive))
      reasons.push(`${path}: default violates maximum`);
  }
  return reasons;
}

/**
 * Length, format and pattern violations of a string constant
 * @param text - String constant
 * @param constraints - Effective restrictions
 * @param path - Source constant property path
 * @returns Violations counted in Unicode code points
 */
function checkString(text: string, constraints: Constraints, path: string): string[] {
  const reasons: string[] = [];
  const length = Array.from(text).length;
  if (constraints.minLength !== undefined && length < constraints.minLength)
    reasons.push(`${path}: default violates minLength`);
  if (constraints.maxLength !== undefined && length > constraints.maxLength)
    reasons.push(`${path}: default violates maxLength`);
  if (constraints.format === "uuid" && !uuidText.test(text))
    reasons.push(`${path}: default violates UUID format`);
  if (constraints.pattern !== undefined && !new RegExp(constraints.pattern, "u").test(text))
    reasons.push(`${path}: default violates pattern`);
  return reasons;
}

/**
 * Item-count violations of an array constant
 * @param count - Number of items
 * @param constraints - Effective restrictions
 * @param path - Source constant property path
 * @returns Violations of the minimum and maximum item counts
 */
function checkItems(count: number, constraints: Constraints, path: string): string[] {
  const reasons: string[] = [];
  if (constraints.minItems !== undefined && count < constraints.minItems)
    reasons.push(`${path}: default violates minItems`);
  if (constraints.maxItems !== undefined && count > constraints.maxItems)
    reasons.push(`${path}: default violates maxItems`);
  return reasons;
}
