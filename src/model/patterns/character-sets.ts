import type { AST } from "@eslint-community/regexpp";
import { Ok, type Result } from "ts-results-es";
import { unsupported, type PatternIssue } from "./pattern-issue.js";

/** Inclusive codepoint interval without Unicode normalization */
export type Range = readonly [number, number];

/** ECMAScript WhiteSpace and LineTerminator codepoints under the Unicode flag */
const whitespace: readonly Range[] = [
  [0x09, 0x0d],
  [0x20, 0x20],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];

/** ASCII word characters without ignoreCase canonicalization */
const word: readonly Range[] = [
  [0x30, 0x39],
  [0x41, 0x5a],
  [0x5f, 0x5f],
  [0x61, 0x7a],
];

/**
 * RE2JS scalar escape with no source syntax interpretation
 * @param value - Parsed codepoint
 * @returns Hexadecimal engine escape
 */
export function codepointSource(value: number): string {
  return `\\x{${value.toString(16)}}`;
}

/**
 * Scalar literal eligibility
 * @param node - Parsed character including combined surrogate pairs
 * @returns Literal codepoint or unsupported isolated surrogate
 */
export function scalarCharacter(node: AST.Character): Result<number, PatternIssue> {
  return node.value >= 0xd800 && node.value <= 0xdfff
    ? unsupported(node, "Isolated surrogate literals are unsupported")
    : Ok(node.value);
}

/**
 * Canonical union of possibly overlapping character intervals
 * @param ranges - Unordered inclusive intervals
 * @returns Disjoint sorted intervals
 */
function union(ranges: readonly Range[]): Range[] {
  const ordered = [...ranges].sort((left, right) => left[0] - right[0]);
  const merged: Range[] = [];
  for (const range of ordered) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1] + 1)
      merged[merged.length - 1] = [previous[0], Math.max(previous[1], range[1])];
    else merged.push(range);
  }
  return merged;
}

/**
 * Complement over the ECMAScript Unicode matching alphabet
 * @param ranges - Sorted disjoint inclusive intervals
 * @returns Every codepoint outside the intervals including unmatched UTF-16 units
 */
function complement(ranges: readonly Range[]): Range[] {
  const result: Range[] = [];
  let next = 0;
  for (const [lower, upper] of ranges) {
    if (next < lower) result.push([next, lower - 1]);
    next = upper + 1;
  }
  if (next <= 0x10ffff) result.push([next, 0x10ffff]);
  return result;
}

/**
 * Exact ECMAScript built-in character set
 * @param node - Dot or a parsed character class escape
 * @returns Character intervals or an unsupported property escape
 */
function setRanges(node: AST.CharacterSet): Result<readonly Range[], PatternIssue> {
  if (node.kind === "property")
    return unsupported(node, "Unicode property escapes are unsupported");
  if (node.kind === "any")
    return Ok(
      complement([
        [0x0a, 0x0a],
        [0x0d, 0x0d],
        [0x2028, 0x2029],
      ]),
    );
  const ranges: readonly Range[] =
    node.kind === "digit" ? [[0x30, 0x39]] : node.kind === "word" ? word : whitespace;
  return Ok(node.negate ? complement(ranges) : ranges);
}

/**
 * One ordinary class element interpreted before class union or negation
 * @param node - Unicode-mode class element
 * @returns Inclusive intervals or unsupported syntax
 */
function elementRanges(node: AST.CharacterClassElement): Result<readonly Range[], PatternIssue> {
  switch (node.type) {
    case "Character":
      return scalarCharacter(node).map((value) => [[value, value]]);
    case "CharacterClassRange":
      return scalarCharacter(node.min).andThen((min) =>
        scalarCharacter(node.max).map((max) => [[min, max]]),
      );
    case "CharacterSet":
      return setRanges(node);
    case "CharacterClass":
    case "ClassStringDisjunction":
    case "ExpressionCharacterClass":
      return unsupported(node, "Unicode set operations are unsupported");
  }
}

/**
 * RE2JS class source from canonical intervals including an empty set
 * @param ranges - Inclusive intervals
 * @returns One character atom without nested class syntax
 */
function rangesSource(ranges: readonly Range[]): string {
  if (ranges.length === 0) return "[^\\x{0}-\\x{10ffff}]";
  return `[${ranges
    .map(([lower, upper]) =>
      lower === upper
        ? codepointSource(lower)
        : `${codepointSource(lower)}-${codepointSource(upper)}`,
    )
    .join("")}]`;
}

/**
 * Exact dot and ordinary character class as canonical intervals
 * @param node - Parsed class or character set
 * @returns Sorted disjoint intervals over every codepoint or a blocking capability issue
 */
export function characterSetRanges(
  node: AST.CharacterClass | AST.CharacterSet,
): Result<readonly Range[], PatternIssue> {
  if (node.type === "CharacterSet") return setRanges(node);
  if (node.unicodeSets) return unsupported(node, "Unicode set operations are unsupported");
  const ranges: Range[] = [];
  for (const element of node.elements) {
    const result = elementRanges(element);
    if (result.isErr()) return result;
    for (const range of result.value) ranges.push(range);
  }
  const merged = union(ranges);
  return Ok(node.negate ? complement(merged) : merged);
}

/**
 * Exact dot and ordinary character class translation
 * @param node - Parsed class or character set
 * @returns Equivalent RE2JS atom or a blocking capability issue
 */
export function characterSetSource(
  node: AST.CharacterClass | AST.CharacterSet,
): Result<string, PatternIssue> {
  return characterSetRanges(node).map(rangesSource);
}
