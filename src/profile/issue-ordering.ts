import type { GenerationIssue } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";

/**
 * Source-position ordering used before semantic interpretation has run
 * @param issues - Failures reordered in place by file, offset and rule
 */
export function sortIssuesByLocation(issues: GenerationIssue[]): void {
  issues.sort(
    (left, right) =>
      compareText(left.origin.file, right.origin.file) ||
      left.origin.start - right.origin.start ||
      compareText(left.code, right.code),
  );
}

/**
 * Total ordering that makes the failure list independent of discovery order
 * @param issues - Failures reordered in place by file, offset, subject, rule and reason
 */
export function sortIssuesCanonically(issues: GenerationIssue[]): void {
  issues.sort(
    (left, right) =>
      compareText(left.origin.file, right.origin.file) ||
      left.origin.start - right.origin.start ||
      compareText(left.subject, right.subject) ||
      compareText(left.code, right.code) ||
      compareText(left.reason, right.reason),
  );
}
