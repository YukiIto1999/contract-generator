import type { AST } from "@eslint-community/regexpp";
import { Err, type Result } from "ts-results-es";

/** Source pattern failure before any candidate value evaluation */
export interface PatternIssue {
  /** Syntax or common execution capability failure */
  readonly code: "invalid-pattern" | "unsupported-pattern";
  /** Explanation including the pattern offset when available */
  readonly reason: string;
}

/**
 * Unsupported syntax at its original pattern position
 * @param node - Parsed construct outside the supported profile
 * @param reason - Missing semantic capability
 * @returns Blocking pattern failure
 */
export function unsupported(node: AST.Node, reason: string): Result<never, PatternIssue> {
  return Err({ code: "unsupported-pattern", reason: `${reason} at pattern offset ${node.start}` });
}
