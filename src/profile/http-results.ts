import type { DiagnosticTarget } from "@typespec/compiler";
import type { HttpResult } from "../model/binding-model.js";
import { compareText } from "../model/ordering.js";
import {
  authoredOutcome,
  type BindingContext,
  type HttpResultDeclaration,
} from "./binding-context.js";
import { compileHeaders } from "./http-result-headers.js";
import {
  checkResultMediaType,
  checkResultPayload,
  checkResultStatus,
  type ResultSite,
} from "./http-result-rules.js";

/**
 * Exact HTTP result selectors validated for exhaustiveness and unambiguity
 * @param context - Binding context of the operation
 * @param method - Uppercase HTTP method
 * @returns Result mappings in canonical outcome order
 */
export function compileResults(context: BindingContext, method: string): HttpResult[] {
  const results: HttpResult[] = [];
  const targets = new Map<HttpResult, DiagnosticTarget>();
  const mapped = new Set<string>();
  const entries = [...context.metadata.httpResults].sort((left, right) =>
    compareText(left.value.outcome, right.value.outcome),
  );
  for (const entry of entries) {
    const result = compileResult(context, entry, method, mapped);
    if (!result) continue;
    for (const other of results) reportOverlap(context, other, result, targets, entry.target);
    results.push(result);
    targets.set(result, entry.target);
  }
  for (const outcome of context.outcomes) {
    if (!mapped.has(outcome.name))
      context.issue(
        "missing-outcome-binding",
        context.operation,
        `Outcome ${authoredOutcome(context, outcome.name)} has no HTTP mapping`,
      );
  }
  return results;
}

/**
 * One result mapping with every per-result rule applied
 * @param context - Binding context of the operation
 * @param entry - Result declaration
 * @param method - Uppercase HTTP method
 * @param mapped - Canonical outcome names that already have a mapping
 * @returns The mapping, or undefined when the declaration names no outcome
 */
function compileResult(
  context: BindingContext,
  entry: HttpResultDeclaration,
  method: string,
  mapped: Set<string>,
): HttpResult | undefined {
  const authored = entry.value.outcome;
  const name = context.outcomeNames.get(authored);
  if (!name) {
    context.issue("unknown-outcome", entry.target, `No outcome named ${JSON.stringify(authored)}`);
    return undefined;
  }
  if (mapped.has(name))
    context.issue(
      "duplicate-outcome-binding",
      entry.target,
      `Outcome ${authored} has multiple HTTP mappings`,
    );
  mapped.add(name);
  const outcome = context.outcomes.find((candidate) => candidate.name === name);
  const site: ResultSite = { entry, outcome, authored, method };
  checkResultStatus(context, site);
  const mediaType = checkResultMediaType(context, site);
  checkResultPayload(context, site, mediaType);
  return {
    outcome: name,
    status: entry.value.status,
    ...(mediaType === undefined ? {} : { mediaType }),
    headers: compileHeaders(context, entry, mediaType),
    origin: context.origin(entry.target),
  };
}

/**
 * Both declarations of two result mappings that can match the same response
 * @param context - Binding context of the operation
 * @param earlier - Previously compiled mapping
 * @param later - Newly compiled mapping
 * @param targets - Declaration target of every compiled mapping
 * @param laterTarget - Declaration target of the newly compiled mapping
 */
function reportOverlap(
  context: BindingContext,
  earlier: HttpResult,
  later: HttpResult,
  targets: ReadonlyMap<HttpResult, DiagnosticTarget>,
  laterTarget: DiagnosticTarget,
): void {
  if (!selectorsOverlap(earlier, later)) return;
  const reason = `HTTP selectors for ${authoredOutcome(context, earlier.outcome)} and ${authoredOutcome(context, later.outcome)} can match the same response`;
  context.issue("ambiguous-http-outcome", targets.get(earlier)!, reason);
  context.issue("ambiguous-http-outcome", laterTarget, reason);
}

/**
 * Selector satisfiability without body-order guessing
 * @param left - Previously declared selector
 * @param right - Newly declared selector
 * @returns Existence of a response matching both selectors
 */
function selectorsOverlap(left: HttpResult, right: HttpResult): boolean {
  if (left.status !== right.status || left.mediaType !== right.mediaType) return false;
  for (const [name, value] of Object.entries(left.headers)) {
    if (Object.hasOwn(right.headers, name) && right.headers[name] !== value) return false;
  }
  return true;
}
