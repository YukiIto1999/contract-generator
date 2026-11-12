import type { Outcome } from "../model/contract-model.js";
import type { BindingContext, HttpResultDeclaration } from "./binding-context.js";
import { isBytes, isJsonMediaType, normalizeMediaType } from "./http-tokens.js";

/** Statuses that never carry a response body */
const bodylessStatuses: readonly number[] = [204, 205, 304];

/** Facts about one result mapping shared by its rules */
export interface ResultSite {
  /** Result declaration being validated */
  readonly entry: HttpResultDeclaration;
  /** Outcome the mapping identifies */
  readonly outcome: Outcome | undefined;
  /** Outcome name as the author wrote it */
  readonly authored: string;
  /** Uppercase HTTP method of the operation */
  readonly method: string;
}

/**
 * Normalized media type of a result with the rules that need only the declaration
 * @param context - Binding context of the operation
 * @param site - Result mapping facts
 * @returns Lowercase media type essence, or undefined when the result declares none or an invalid one
 */
export function checkResultMediaType(
  context: BindingContext,
  site: ResultSite,
): string | undefined {
  const { entry, outcome, authored } = site;
  const mediaType =
    entry.value.mediaType === undefined ? undefined : normalizeMediaType(entry.value.mediaType);
  if (entry.value.mediaType !== undefined && mediaType === undefined)
    context.issue(
      "invalid-media-type",
      entry.target,
      "The result media type must contain a valid type and subtype",
    );
  if (outcome?.type === undefined && entry.value.mediaType !== undefined)
    context.issue(
      "void-media-type",
      entry.target,
      `Void outcome ${authored} must omit its media type`,
    );
  if (outcome?.type !== undefined && mediaType === undefined)
    context.issue(
      "missing-media-type",
      entry.target,
      `Payload outcome ${authored} requires an explicit media type`,
    );
  return mediaType;
}

/**
 * Status range and outcome-role agreement of a result
 * @param context - Binding context of the operation
 * @param site - Result mapping facts
 */
export function checkResultStatus(context: BindingContext, site: ResultSite): void {
  const { entry, outcome, authored } = site;
  const { status } = entry.value;
  if (!Number.isInteger(status) || status < 200 || status > 599)
    context.issue(
      "invalid-http-status",
      entry.target,
      "A terminal outcome requires an exact HTTP status from 200 through 599",
    );
  else if (outcome && (outcome.rejection ? status < 400 : status >= 300))
    context.issue(
      "invalid-outcome-status",
      entry.target,
      outcome.rejection
        ? `Declared rejection ${authored} requires a 4xx or 5xx status`
        : `Successful outcome ${authored} requires a 2xx status`,
    );
}

/**
 * Payload representability for the status, method and media type of a result
 * @param context - Binding context of the operation
 * @param site - Result mapping facts
 * @param mediaType - Normalized media type of the result
 */
export function checkResultPayload(
  context: BindingContext,
  site: ResultSite,
  mediaType: string | undefined,
): void {
  const { entry, outcome, authored, method } = site;
  const payload = outcome?.type;
  if (payload === undefined) return;
  const { status } = entry.value;
  if (bodylessStatuses.includes(status) || method === "HEAD")
    context.issue(
      "forbidden-response-body",
      entry.target,
      `HTTP ${method} status ${status} cannot carry outcome ${authored}'s payload`,
    );
  if (mediaType === undefined || isJsonMediaType(mediaType)) return;
  if (!isBytes(payload, context.types))
    context.issue(
      "unsupported-media-type",
      entry.target,
      `Nonbinary payload ${authored} requires a JSON media type rather than ${mediaType}`,
    );
  else if (payload.nullable)
    context.issue(
      "nullable-binary-result",
      entry.target,
      `Raw binary outcome ${authored} cannot represent JSON null`,
    );
}
