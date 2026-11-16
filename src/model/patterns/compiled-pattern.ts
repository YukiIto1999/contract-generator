import { RegExpParser, RegExpSyntaxError, type AST } from "@eslint-community/regexpp";
import { RE2JS, RE2JSCompileException, RE2JSSyntaxException } from "re2js";
import { Err, Ok, type Result } from "ts-results-es";
import { dotnetPattern, type DotNetPattern } from "./dotnet-translation.js";
import type { PatternIssue } from "./pattern-issue.js";
import { translatePattern } from "./pattern-translation.js";

/** Prepared private executor kept outside canonical constraints */
export interface PreparedPattern {
  /** Equivalent engine source for generated runtime compilation */
  readonly source: string;
  /** Boolean unanchored matcher of the original string */
  readonly expression: RE2JS;
}

/**
 * ECMAScript Unicode parsing without invoking the native matcher
 * @param source - Original contract pattern
 * @returns Parsed syntax or an expected syntax failure
 * @throws {@link Error} Unexpected parser defect
 */
function parsePattern(source: string): Result<AST.Pattern, PatternIssue> {
  try {
    return Ok(
      new RegExpParser({ ecmaVersion: 2025 }).parsePattern(source, 0, source.length, {
        unicode: true,
      }),
    );
  } catch (cause) {
    if (cause instanceof RegExpSyntaxError)
      return Err({ code: "invalid-pattern", reason: cause.message });
    throw cause;
  }
}

/**
 * Preflight of the pinned engine compilation capability
 * @param source - Translated engine syntax rather than contract source
 * @returns Prepared matcher or an expected engine capability failure
 * @throws {@link Error} Unexpected engine defect
 */
function compilePattern(source: string): Result<PreparedPattern, PatternIssue> {
  try {
    return Ok({ source, expression: RE2JS.compile(source) });
  } catch (cause) {
    if (cause instanceof RE2JSSyntaxException || cause instanceof RE2JSCompileException)
      return Err({
        code: "unsupported-pattern",
        reason: `Pattern exceeds the safe engine capability: ${cause.message}`,
      });
    throw cause;
  }
}

/**
 * Safe execution eligibility before defaults or finite-domain evaluation
 * @param source - Original ECMAScript Unicode pattern without other flags
 * @returns Equivalent private executor or a blocking generation issue
 * @throws {@link Error} Unexpected parser or engine defect
 */
export function preparePattern(source: string): Result<PreparedPattern, PatternIssue> {
  return parsePattern(source).andThen(translatePattern).andThen(compilePattern);
}

/**
 * .NET non-backtracking eligibility, which holds a pattern to the common profile first
 * @param source - Original ECMAScript Unicode pattern without other flags
 * @returns Expression for `RegexOptions.NonBacktracking` or a blocking issue
 * @throws {@link Error} Unexpected parser or engine defect
 */
export function prepareDotNetPattern(source: string): Result<DotNetPattern, PatternIssue> {
  return preparePattern(source)
    .andThen(() => parsePattern(source))
    .andThen(dotnetPattern);
}
