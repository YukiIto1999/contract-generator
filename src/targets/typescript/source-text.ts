import { compareText } from "../../model/ordering.js";

/** Nested source fragments flattened by {@link lines} */
export type SourcePart = string | readonly SourcePart[] | false | undefined;

/** TSDoc tags of a generated declaration */
export interface DocTags {
  /** Additional contract detail following the summary */
  readonly remarks?: string;
  /** Type parameters with their meaning */
  readonly typeParams?: readonly (readonly [name: string, meaning: string])[];
  /** Parameters in declaration order with their meaning */
  readonly params?: readonly (readonly [name: string, meaning: string])[];
  /** Meaning of the returned value */
  readonly returns?: string;
  /** Direct throw escaping the declaration as an error reference and its condition */
  readonly throws?: readonly [error: string, condition: string];
}

/**
 * Stable JavaScript source string with sorted object keys
 * @param value - Source-independent JSON-compatible value
 * @returns Escaped literal
 */
export function quote(value: unknown): string {
  return JSON.stringify(value, sortedKeys) ?? "undefined";
}

/**
 * Key-sorting JSON replacer for deterministic literals
 * @param _key - Property name of the visited value
 * @param child - Visited value
 * @returns Value with deterministic key order
 */
function sortedKeys(_key: string, child: unknown): unknown {
  if (child === null || typeof child !== "object" || Array.isArray(child)) return child;
  return Object.fromEntries(
    Object.entries(child).sort(([left], [right]) => compareText(left, right)),
  );
}

/**
 * Flattened newline-joined source without absent fragments
 * @param parts - Source fragments, nested arrays and absent markers
 * @returns Joined source text
 */
export function lines(...parts: readonly SourcePart[]): string {
  return flatten(parts).join("\n");
}

/**
 * Fragment flattening preserving order
 * @param parts - Source fragments
 * @returns Present lines
 */
function flatten(parts: readonly SourcePart[]): string[] {
  return parts.flatMap((part) => {
    if (part === false || part === undefined) return [];
    return typeof part === "string" ? [part] : flatten(part);
  });
}

/**
 * Uniform two-space block indentation
 * @param text - Source block
 * @param depth - Number of nested levels
 * @returns Indented block with blank lines untouched
 */
export function indent(text: string, depth = 1): string {
  const prefix = "  ".repeat(depth);
  return text
    .split("\n")
    .map((line) => (line === "" ? line : prefix + line))
    .join("\n");
}

/**
 * Single-line comment text that cannot close its comment
 * @param text - Contract documentation
 * @param fallback - Text for an undocumented declaration
 * @returns Safe single-line text
 */
export function docText(text: string, fallback: string): string {
  const flat = text
    .replace(/\*\//g, "* /")
    .replace(/\s*\r?\n\s*/g, " ")
    .trim();
  return flat === "" ? fallback : flat;
}

/**
 * TSDoc contract of one generated declaration
 * @param summary - Purpose of the declaration
 * @param tags - Parameters, return value and escaping defects
 * @returns Complete documentation comment
 */
export function tsdoc(summary: string, tags: DocTags = {}): string {
  const body = [
    docText(summary, "Generated declaration"),
    ...(tags.remarks === undefined ? [] : [`@remarks ${tags.remarks}`]),
    ...(tags.typeParams ?? []).map(([name, meaning]) => `@typeParam ${name} - ${meaning}`),
    ...(tags.params ?? []).map(([name, meaning]) => `@param ${name} - ${meaning}`),
    ...(tags.returns === undefined ? [] : [`@returns ${tags.returns}`]),
    ...(tags.throws === undefined ? [] : [`@throws {@link ${tags.throws[0]}} ${tags.throws[1]}`]),
  ];
  return ["/**", ...body.map((line) => ` * ${line}`), " */"].join("\n");
}

/**
 * Pascal-case identifier stem from arbitrary contract text
 * @param text - Member, outcome or type text
 * @returns Alphanumeric stem starting with an upper-case letter or digit
 */
export function pascal(text: string): string {
  const words = text.split(/[^A-Za-z0-9]+/).filter((word) => word !== "");
  const stem = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
  return stem === "" ? "Member" : stem;
}

/**
 * Lower-case-initial identifier from contract text
 * @param text - Declaration or member text
 * @returns camelCase identifier stem
 */
export function camel(text: string): string {
  const stem = pascal(text);
  return stem.charAt(0).toLowerCase() + stem.slice(1);
}
