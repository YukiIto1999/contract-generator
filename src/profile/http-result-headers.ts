import { compareText } from "../model/ordering.js";
import type { BindingContext, HttpResultDeclaration } from "./binding-context.js";
import { hasLineBreak, headerToken, normalizeMediaType } from "./http-tokens.js";

/**
 * Header selectors of one result with validity, uniqueness and media type agreement
 * @param context - Binding context of the operation
 * @param entry - Result declaration holding the selectors
 * @param mediaType - Normalized media type of the result
 * @returns Lowercase header names mapped to their exact values in name order
 */
export function compileHeaders(
  context: BindingContext,
  entry: HttpResultDeclaration,
  mediaType: string | undefined,
): Record<string, string> {
  const headers: Record<string, string> = Object.create(null) as Record<string, string>;
  const declared = Object.entries(entry.value.headers).sort(([left], [right]) =>
    compareText(left, right),
  );
  for (const [rawHeader, value] of declared) {
    const header = rawHeader.toLowerCase();
    if (!headerToken.test(header) || hasLineBreak(value))
      context.issue(
        "invalid-header-selector",
        entry.target,
        "HTTP result selectors require valid header names and single-line values",
      );
    if (Object.hasOwn(headers, header))
      context.issue(
        "duplicate-header-selector",
        entry.target,
        `Header selector ${header} is repeated with different casing`,
      );
    if (header === "content-type" && !agreesWithMediaType(value, mediaType))
      context.issue(
        "conflicting-media-selector",
        entry.target,
        "The Content-Type selector conflicts with the result media type",
      );
    headers[header] = value;
  }
  return headers;
}

/**
 * Agreement of a Content-Type selector with the declared result media type
 * @param value - Selector value
 * @param mediaType - Normalized media type of the result
 * @returns Whether the selector names the same media type essence
 */
function agreesWithMediaType(value: string, mediaType: string | undefined): boolean {
  return mediaType !== undefined && normalizeMediaType(value) === mediaType;
}
