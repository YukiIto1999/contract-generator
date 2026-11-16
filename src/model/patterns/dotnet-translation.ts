import type { AST } from "@eslint-community/regexpp";
import { Err, Ok, type Result } from "ts-results-es";
import { characterSetRanges } from "./character-sets.js";
import type { PatternIssue } from "./pattern-issue.js";
import { translatePattern, type Atoms } from "./pattern-translation.js";
import { literalLeaves, utf16Leaves, utf16Literal, utf16Set, utf16Source } from "./utf16-sets.js";

/** Largest estimated automaton that .NET builds for `RegexOptions.NonBacktracking` unless the host raises its limit */
const automatonLimit = 10_000;
/** Factor by which .NET scales the estimate of an expression that contains an anchor, for the five kinds of adjacent character */
const anchorKinds = 5;

/** Expression for `RegexOptions.NonBacktracking` with the size that .NET estimates for it */
export interface DotNetPattern {
  /** .NET regular expression source over UTF-16 code units */
  readonly source: string;
  /** Estimated number of automaton nodes, at most the engine limit */
  readonly size: number;
}

/**
 * .NET reads UTF-16 code units, so literals and sets are spelled as whole surrogate pairs and a boolean match ignores laziness.
 * Its tree reduction rewrites an alternation of a counted single-character loop and an empty alternative into an optional loop,
 * and then merges that loop into an enclosing loop with its lower bound lost, so `(?:a+|)+` would reject the empty text.
 * Spelling the optional group directly avoids that rewrite.
 */
const dotnetAtoms: Atoms = {
  literal: utf16Literal,
  set: (node) => characterSetRanges(node).map((ranges) => utf16Source(utf16Set(ranges))),
  lazy: false,
  optionalEmpty: true,
};

/** Regex leaves of an unfolded expression and whether it contains an anchor */
interface Weight {
  /** Number of literals and sets once every counted repetition is written out */
  readonly leaves: number;
  /** Whether any `^` or `$` occurs */
  readonly anchored: boolean;
}

/**
 * Weight of a sequence or a choice
 * @param parts - Weights of the members
 * @returns Sum of the leaves, anchored when any member is
 */
function combine(parts: readonly Weight[]): Weight {
  return {
    leaves: parts.reduce((total, part) => total + part.leaves, 0),
    anchored: parts.some((part) => part.anchored),
  };
}

/**
 * Weight of a repetition as .NET counts it
 * @param node - Parsed quantifier
 * @param body - Weight of the repeated element
 * @returns One copy for `*` and `?`, one more than the minimum for an open count, otherwise the maximum
 */
function repeated(node: AST.Quantifier, body: Weight): Weight {
  const { min, max } = node;
  const copies = max === Infinity ? (min === 0 ? 1 : min + 1) : max;
  return { leaves: copies * body.leaves, anchored: body.anchored };
}

/**
 * Weight of one syntax node of a pattern that translated
 * @param node - Parsed node
 * @returns Leaves and anchoring
 * @throws {@link Error} A class that the translation had already rejected
 */
function weigh(node: AST.Node): Weight {
  switch (node.type) {
    case "Pattern":
    case "Group":
    case "CapturingGroup":
      return combine(node.alternatives.map(weigh));
    case "Alternative":
      return combine(node.elements.map(weigh));
    case "Quantifier":
      return repeated(node, weigh(node.element));
    case "Character":
      return { leaves: literalLeaves(node.value), anchored: false };
    case "CharacterClass":
    case "CharacterSet":
      return { leaves: utf16Leaves(utf16Set(characterSetRanges(node).unwrap())), anchored: false };
    case "Assertion":
      return { leaves: 0, anchored: true };
    case "Backreference":
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
      return { leaves: 0, anchored: false };
  }
}

/**
 * Automaton size that .NET estimates before it builds a non-backtracking matcher
 *
 * The estimate unfolds counted repetitions and counts each literal and each set once, with every pair of a
 * supplementary set counted twice. It never counts the merges that .NET performs while it reduces the tree,
 * so it is an upper bound of what the engine tests against its limit.
 * @param pattern - Parsed pattern that translated
 * @returns Leaves plus the initial node, times five when the pattern contains an anchor
 */
function automatonSize(pattern: AST.Pattern): number {
  const { leaves, anchored } = weigh(pattern);
  return (anchored ? anchorKinds : 1) * (1 + leaves);
}

/**
 * Safe .NET spelling of a pattern of the common profile
 * @param pattern - Parsed pattern that the common profile admits
 * @returns Expression for `RegexOptions.NonBacktracking`, or the construct that the engine cannot build
 */
export function dotnetPattern(pattern: AST.Pattern): Result<DotNetPattern, PatternIssue> {
  return translatePattern(pattern, dotnetAtoms).andThen(
    (source): Result<DotNetPattern, PatternIssue> => {
      const size = automatonSize(pattern);
      if (size <= automatonLimit) return Ok({ source, size });
      return Err({
        code: "unsupported-pattern",
        reason: `The .NET non-backtracking engine builds only expressions whose estimated automaton has at most ${automatonLimit} nodes; this one has ${size}`,
      });
    },
  );
}
