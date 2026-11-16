import type { Range } from "./character-sets.js";

/** First code unit of the high surrogates */
const highSurrogateStart = 0xd800;
/** First code unit of the low surrogates */
const lowSurrogateStart = 0xdc00;
/** Last code unit of the low surrogates, and so of the surrogate block */
const lowSurrogateEnd = 0xdfff;
/** First code point outside the Basic Multilingual Plane */
const supplementaryStart = 0x10000;

/** Surrogate-pair alternative: every high surrogate of one interval followed by one interval of low surrogates */
interface Pair {
  /** High surrogate code units */
  readonly highs: Range;
  /** Low surrogate code units */
  readonly lows: Range;
}

/** Whole code points spelled over UTF-16 units: the Basic Multilingual Plane without surrogates, and surrogate pairs */
export interface Utf16Set {
  /** Code units of the Basic Multilingual Plane outside the surrogate block */
  readonly bmp: readonly Range[];
  /** Alternatives that spell the supplementary planes */
  readonly pairs: readonly Pair[];
}

/**
 * Escape of one UTF-16 code unit in .NET regular expression syntax
 * @param unit - Code unit
 * @returns Four-digit `\u` escape that is valid inside and outside a class
 */
function unitEscape(unit: number): string {
  return `\\u${unit.toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Surrogate pair of a supplementary code point
 * @param point - Code point, at least U+10000
 * @returns High and low code unit
 */
function pairUnits(point: number): readonly [number, number] {
  const offset = point - supplementaryStart;
  return [highSurrogateStart + (offset >> 10), lowSurrogateStart + (offset & 0x3ff)];
}

/**
 * Surrogate-pair alternatives of one supplementary interval
 * @param lower - First code point, at least U+10000
 * @param upper - Last code point
 * @returns Alternatives whose union is exactly the interval
 */
function pairsOf(lower: number, upper: number): Pair[] {
  const [firstHigh, firstLow] = pairUnits(lower);
  const [lastHigh, lastLow] = pairUnits(upper);
  if (firstHigh === lastHigh) return [{ highs: [firstHigh, firstHigh], lows: [firstLow, lastLow] }];
  const startsMidBlock = firstLow !== lowSurrogateStart;
  const endsMidBlock = lastLow !== lowSurrogateEnd;
  const pairs: Pair[] = [];
  if (startsMidBlock)
    pairs.push({ highs: [firstHigh, firstHigh], lows: [firstLow, lowSurrogateEnd] });
  const middle: Range = [firstHigh + (startsMidBlock ? 1 : 0), lastHigh - (endsMidBlock ? 1 : 0)];
  if (middle[0] <= middle[1])
    pairs.push({ highs: middle, lows: [lowSurrogateStart, lowSurrogateEnd] });
  if (endsMidBlock) pairs.push({ highs: [lastHigh, lastHigh], lows: [lowSurrogateStart, lastLow] });
  return pairs;
}

/**
 * Code point intervals as whole UTF-16 sequences
 *
 * Text that reaches a generated check is well formed, so an unpaired surrogate is never consumed
 * and a pair is never split into two matches.
 * @param ranges - Sorted disjoint inclusive code point intervals
 * @returns Code units outside the surrogate block, and alternatives for the supplementary planes
 */
export function utf16Set(ranges: readonly Range[]): Utf16Set {
  const bmp: Range[] = [];
  const pairs: Pair[] = [];
  for (const [lower, upper] of ranges) {
    const below: Range = [lower, Math.min(upper, highSurrogateStart - 1)];
    const above: Range = [Math.max(lower, lowSurrogateEnd + 1), Math.min(upper, 0xffff)];
    for (const part of [below, above]) if (part[0] <= part[1]) bmp.push(part);
    if (upper >= supplementaryStart)
      pairs.push(...pairsOf(Math.max(lower, supplementaryStart), upper));
  }
  return { bmp, pairs };
}

/**
 * Interval of code units as a class member
 * @param range - Inclusive code units
 * @returns Escape of one unit, or of both ends joined by a hyphen
 */
function memberSource([lower, upper]: Range): string {
  return lower === upper ? unitEscape(lower) : `${unitEscape(lower)}-${unitEscape(upper)}`;
}

/**
 * Interval of code units as one atom
 * @param range - Inclusive code units
 * @returns Escape of one unit, or a class of the interval
 */
function unitSource(range: Range): string {
  return range[0] === range[1] ? unitEscape(range[0]) : `[${memberSource(range)}]`;
}

/**
 * .NET expression that matches exactly the code points of a set
 * @param set - Code points spelled over UTF-16 units
 * @returns One atom; the empty set is a class that no UTF-16 unit satisfies
 */
export function utf16Source(set: Utf16Set): string {
  const alternatives = [
    ...(set.bmp.length === 0 ? [] : [`[${set.bmp.map(memberSource).join("")}]`]),
    ...set.pairs.map(({ highs, lows }) => unitSource(highs) + unitSource(lows)),
  ];
  if (alternatives.length === 0) return `[^${memberSource([0, 0xffff])}]`;
  return alternatives.length === 1 ? alternatives[0]! : `(?:${alternatives.join("|")})`;
}

/**
 * Number of regex leaves that a set contributes to the .NET size estimate
 * @param set - Code points spelled over UTF-16 units
 * @returns One leaf for its class of code units and two for every pair alternative; at least one
 */
export function utf16Leaves(set: Utf16Set): number {
  return Math.max(1, (set.bmp.length === 0 ? 0 : 1) + 2 * set.pairs.length);
}

/**
 * .NET expression of one scalar literal
 * @param value - Unicode scalar value
 * @returns One escape, or the two escapes of its surrogate pair
 */
export function utf16Literal(value: number): string {
  return (value < supplementaryStart ? [value] : pairUnits(value)).map(unitEscape).join("");
}

/**
 * Regex leaves of one scalar literal
 * @param value - Unicode scalar value
 * @returns One leaf for a code unit and two for a pair
 */
export function literalLeaves(value: number): number {
  return value < supplementaryStart ? 1 : 2;
}
