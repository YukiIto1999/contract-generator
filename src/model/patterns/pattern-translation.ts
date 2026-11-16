import type { AST } from "@eslint-community/regexpp";
import { Ok, type Result } from "ts-results-es";
import { characterSetSource, codepointSource, scalarCharacter } from "./character-sets.js";
import { unsupported, type PatternIssue } from "./pattern-issue.js";

/** Pending syntax node or already translated engine fragment */
type Piece = AST.Node | string;

/** Engine spelling of the pieces that depend on how the engine reads text */
export interface Atoms {
  /** One Unicode scalar literal */
  readonly literal: (value: number) => string;
  /** One dot, character class or class escape */
  readonly set: (node: AST.CharacterClass | AST.CharacterSet) => Result<string, PatternIssue>;
  /** Whether a lazy quantifier keeps its marker; a boolean match never depends on it */
  readonly lazy: boolean;
  /** Whether a group with an empty alternative is spelled as an optional group of the others, which the engine's own rewriting of the alternation would otherwise mishandle */
  readonly optionalEmpty: boolean;
}

/** RE2JS reads whole code points, so literals and sets are spelled as code points */
const re2Atoms: Atoms = {
  literal: codepointSource,
  set: characterSetSource,
  lazy: true,
  optionalEmpty: false,
};

/** Maximum explicit repetition count accepted by the pinned RE2JS parser */
const maximumRepeat = 1000;

/**
 * Eligibility of explicit counts without confusing numeric overflow with an omitted upper bound
 * @param node - Parsed repetition retaining its original quantifier token
 * @returns Whether each explicit count is within the pinned engine capability
 */
function supportsCount(node: AST.Quantifier): boolean {
  if (node.min > maximumRepeat) return false;
  if (node.max !== Infinity) return node.max <= maximumRepeat;
  const token = node.raw.slice(node.element.end - node.start);
  const greedyToken = node.greedy ? token : token.slice(0, -1);
  return !greedyToken.startsWith("{") || greedyToken.endsWith(",}");
}

/**
 * Alternation without treating an empty alternative as an empty character set
 * @param alternatives - Parsed alternatives in source order
 * @returns Pending syntax separated by engine alternation
 */
function alternativesSource(alternatives: readonly AST.Alternative[]): Piece[] {
  const pieces: Piece[] = [];
  for (const alternative of alternatives) {
    if (pieces.length > 0) pieces.push("|");
    pieces.push(alternative);
  }
  return pieces;
}

/**
 * Group around its alternatives
 * @param alternatives - Parsed alternatives in source order
 * @param atoms - Engine spelling of literals and sets
 * @returns Pending syntax of a non-capturing group
 */
function groupSource(alternatives: readonly AST.Alternative[], atoms: Atoms): Piece[] {
  const present = alternatives.filter((alternative) => alternative.elements.length > 0);
  if (!atoms.optionalEmpty || alternatives.length < 2 || present.length === alternatives.length)
    return ["(?:", ...alternativesSource(alternatives), ")"];
  return present.length === 0 ? ["(?:)"] : ["(?:(?:", ...alternativesSource(present), ")?)"];
}

/**
 * Canonical counted repetition without source-dependent decimal spelling
 * @param node - Parsed repetition
 * @param lazy - Whether the engine keeps the lazy marker
 * @returns Equivalent repetition with the original greediness when the engine keeps it
 */
function quantifierSource(node: AST.Quantifier, lazy: boolean): string {
  const { min, max } = node;
  const count =
    min === 0 && max === 1
      ? "?"
      : min === 0 && max === Infinity
        ? "*"
        : min === 1 && max === Infinity
          ? "+"
          : min === max
            ? `{${min}}`
            : `{${min},${max === Infinity ? "" : max}}`;
  return count + (lazy && !node.greedy ? "?" : "");
}

/**
 * Closed translation of one ECMAScript Unicode syntax construct
 * @param node - Original parsed syntax node
 * @param atoms - Engine spelling of literals and sets
 * @returns Equivalent engine fragments or a blocking unsupported construct
 */
function expand(node: AST.Node, atoms: Atoms): Result<readonly Piece[], PatternIssue> {
  switch (node.type) {
    case "Pattern":
      return Ok(alternativesSource(node.alternatives));
    case "Alternative":
      return Ok(node.elements);
    case "Group":
      if (node.modifiers !== null)
        return unsupported(node, "Inline flag modifiers are unsupported");
      return Ok(groupSource(node.alternatives, atoms));
    case "CapturingGroup":
      return Ok(groupSource(node.alternatives, atoms));
    case "Quantifier":
      if (!supportsCount(node))
        return unsupported(node, "Explicit repetition exceeds the safe engine capability");
      return Ok(["(?:", node.element, ")", quantifierSource(node, atoms.lazy)]);
    case "Character":
      return scalarCharacter(node).map((value) => [atoms.literal(value)]);
    case "CharacterClass":
    case "CharacterSet":
      return atoms.set(node).map((source) => [source]);
    case "Assertion":
      if (node.kind === "start") return Ok(["\\A"]);
      if (node.kind === "end") return Ok(["\\z"]);
      return unsupported(node, "Lookaround and word-boundary assertions are unsupported");
    case "Backreference":
      return unsupported(node, "Backreferences are unsupported");
    case "CharacterClassRange":
    case "ClassIntersection":
    case "ClassStringDisjunction":
    case "ClassSubtraction":
    case "ExpressionCharacterClass":
    case "Flags":
    case "ModifierFlags":
    case "Modifiers":
    case "RegExpLiteral":
    case "StringAlternative":
      return unsupported(node, "This ECMAScript construct is outside the safe pattern profile");
  }
}

/**
 * Equivalent engine syntax without a native matching fallback
 * @param pattern - ECMAScript Unicode AST with no additional flags
 * @param atoms - Engine spelling of literals and sets; RE2JS by default
 * @returns Engine source or the first unsupported construct
 */
export function translatePattern(
  pattern: AST.Pattern,
  atoms: Atoms = re2Atoms,
): Result<string, PatternIssue> {
  const pending: Piece[] = [pattern];
  const fragments: string[] = [];
  while (pending.length > 0) {
    const piece = pending.pop()!;
    if (typeof piece === "string") {
      fragments.push(piece);
      continue;
    }
    const result = expand(piece, atoms);
    if (result.isErr()) return result;
    for (let index = result.value.length - 1; index >= 0; index--)
      pending.push(result.value[index]!);
  }
  return Ok(fragments.join(""));
}
