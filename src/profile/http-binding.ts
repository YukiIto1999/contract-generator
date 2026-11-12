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
 * Route template shape: absolute, without query, fragment, whitespace or malformed placeholders
 * @param context - Binding context of the operation
 * @param target - Route declaration target
 * @param path - Declared route template
 */
function checkPath(context: BindingContext, target: DiagnosticTarget, path: string): void {
  if (
    !path.startsWith("/") ||
    /[?#\s]/.test(path) ||
    /[{}]/.test(path.replace(placeholderPattern, ""))
  )
    context.issue(
      "invalid-http-path",
      target,
      "The route must be an absolute path template without query or fragment or malformed placeholders",
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
