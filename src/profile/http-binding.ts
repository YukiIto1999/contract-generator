import type { DiagnosticTarget } from "@typespec/compiler";
import type { HttpBinding, HttpParameter } from "../model/binding-model.js";
import type { BindingContext } from "./binding-context.js";
import { compileBody } from "./http-body.js";
import { compileParameters } from "./http-parameters.js";
import { compileResults } from "./http-results.js";

/** HTTP method token grammar of RFC 9110 */
const methodToken = /^[!#$%&'*+.^_`|~0-9A-Z-]+$/;

/** Placeholder of a route template with its capturing name */
const placeholderPattern = /\{([^{}]+)\}/g;

/** Path segment that a URL parser resolves to the current or parent segment, including percent-encoded dots */
const dotSegment = /^(?:\.|%2e)(?:\.|%2e)?$/i;

/**
 * Complete HTTP route, placement and selector interpretation
 * @param context - Binding context of the operation
 * @returns Complete HTTP binding, or undefined when no route is declared
 */
export function compileHttp(context: BindingContext): HttpBinding | undefined {
  const { issue, metadata, origin } = context;
  if (metadata.http.length !== 1)
    issue(
      "http-binding-count",
      context.operation,
      "An HTTP publication requires exactly one @httpBinding declaration",
    );
  const route = metadata.http[0];
  if (!route) return undefined;
  const method = route.value.method.toUpperCase();
  if (!methodToken.test(method))
    issue("invalid-http-method", route.target, "The HTTP method must be a nonempty HTTP token");
  const path = route.value.path;
  checkPath(context, route.target, path);
  const { parameters, placed } = compileParameters(context);
  checkPlaceholders(context, route.target, path, parameters);
  const { body, requestMediaType } = compileBody(context, route, method, placed);
  const results = compileResults(context, method);
  return {
    method,
    path,
    body,
    requestMediaType,
    parameters,
    results,
    origin: origin(route.target),
  };
}

/**
 * Whether a route segment cannot be carried as one literal or one whole placeholder
 * @param segment - Route segment between two slashes
 * @param last - Whether the segment ends the route, where an empty segment is a trailing slash
 * @returns True for an empty inner segment, a dot segment, or a partial or malformed placeholder
 */
function unsafeSegment(segment: string, last: boolean): boolean {
  if (segment === "") return !last;
  if (dotSegment.test(segment)) return true;
  return /[{}]/.test(segment) && segment.match(placeholderPattern)?.[0] !== segment;
}

/**
 * Route template shape: absolute, one URL path of nonempty segments, without query, fragment,
 * whitespace, backslash, dot segments or placeholders that do not fill a whole segment
 * @param context - Binding context of the operation
 * @param target - Route declaration target
 * @param path - Declared route template
 */
function checkPath(context: BindingContext, target: DiagnosticTarget, path: string): void {
  if (
    !path.startsWith("/") ||
    /[?#\s\\]/.test(path) ||
    path
      .slice(1)
      .split("/")
      .some((segment, index, segments) => unsafeSegment(segment, index === segments.length - 1))
  )
    context.issue(
      "invalid-http-path",
      target,
      "The route must be an absolute path template of nonempty, non-dot segments, with whole-segment placeholders and without query, fragment or backslash",
    );
}

/**
 * One-to-one correspondence between route placeholders and path placements
 * @param context - Binding context of the operation
 * @param target - Route declaration target
 * @param path - Declared route template
 * @param parameters - Validated placements
 */
function checkPlaceholders(
  context: BindingContext,
  target: DiagnosticTarget,
  path: string,
  parameters: readonly HttpParameter[],
): void {
  const placeholders = [...path.matchAll(placeholderPattern)].map((match) => match[1] ?? "");
  if (new Set(placeholders).size !== placeholders.length)
    context.issue(
      "duplicate-path-placeholder",
      target,
      "A path placeholder must occur exactly once",
    );
  for (const placeholder of placeholders) {
    if (!parameters.some((entry) => entry.location === "path" && entry.wireName === placeholder))
      context.issue(
        "missing-path-parameter",
        target,
        `Path placeholder ${placeholder} has no matching parameter placement`,
      );
  }
  for (const entry of parameters) {
    if (entry.location === "path" && !placeholders.includes(entry.wireName))
      context.issue(
        "unused-path-parameter",
        target,
        `Path placement ${entry.wireName} has no route placeholder`,
      );
  }
}
