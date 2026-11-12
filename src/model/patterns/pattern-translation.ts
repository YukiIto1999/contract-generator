import type { AST } from "@eslint-community/regexpp";
import { Ok, type Result } from "ts-results-es";
import { characterSetSource, codepointSource, scalarCharacter } from "./character-sets.js";
import { unsupported, type PatternIssue } from "./pattern-issue.js";

/** Pending syntax node or already translated engine fragment */
type Piece = AST.Node | string;

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
 * Canonical counted repetition without source-dependent decimal spelling
 * @param node - Parsed repetition
 * @returns Equivalent repetition with the original greediness
 */
function quantifierSource(node: AST.Quantifier): string {
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
  return count + (node.greedy ? "" : "?");
}

/**
 * Closed translation of one ECMAScript Unicode syntax construct
 * @param node - Original parsed syntax node
 * @returns Equivalent engine fragments or a blocking unsupported construct
 */
function expand(node: AST.Node): Result<readonly Piece[], PatternIssue> {
  switch (node.type) {
    case "Pattern":
      return Ok(alternativesSource(node.alternatives));
    case "Alternative":
      return Ok(node.elements);
    case "Group":
      if (node.modifiers !== null)
        return unsupported(node, "Inline flag modifiers are unsupported");
      return Ok(["(?:", ...alternativesSource(node.alternatives), ")"]);
    case "CapturingGroup":
      return Ok(["(?:", ...alternativesSource(node.alternatives), ")"]);
    case "Quantifier":
      if (!supportsCount(node))
        return unsupported(node, "Explicit repetition exceeds the safe engine capability");
      return Ok(["(?:", node.element, ")", quantifierSource(node)]);
    case "Character":
      return scalarCharacter(node).map((value) => [codepointSource(value)]);
    case "CharacterClass":
    case "CharacterSet":
      return characterSetSource(node).map((source) => [source]);
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
 * Equivalent RE2JS syntax without a native matching fallback
 * @param pattern - ECMAScript Unicode AST with no additional flags
 * @returns Engine source or the first unsupported construct
 */
export function translatePattern(pattern: AST.Pattern): Result<string, PatternIssue> {
  const pending: Piece[] = [pattern];
  const fragments: string[] = [];
  while (pending.length > 0) {
    const piece = pending.pop()!;
    if (typeof piece === "string") {
      fragments.push(piece);
      continue;
    }
    const result = expand(piece);
    if (result.isErr()) return result;
    for (let index = result.value.length - 1; index >= 0; index--)
      pending.push(result.value[index]!);
  }
  return Ok(fragments.join(""));
}
