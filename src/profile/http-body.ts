import type { HttpBody } from "../model/binding-model.js";
import type { BindingContext, RouteDeclaration } from "./binding-context.js";
import { isBytes } from "./http-tokens.js";

/** Request body ownership with the media type that identifies it */
export interface CompiledBody {
  /** Body placement */
  readonly body: HttpBody;
  /** Declared body media type */
  readonly requestMediaType: string;
}

/** Methods whose request carries the remaining parameters as a body unless stated otherwise */
const bodyMethods: readonly string[] = ["POST", "PUT", "PATCH"];

/** Media type of a JSON object or JSON value body */
const jsonMediaType = "application/json";

/** Media type of a raw byte sequence body */
const binaryMediaType = "application/octet-stream";

/**
 * Request body ownership and the complete placement of every input
 * @param context - Binding context of the operation
 * @param route - Route declaration holding the body selector
 * @param method - Uppercase HTTP method
 * @param placed - Input names that have a placement outside the body
 * @returns Body placement and media type
 */
export function compileBody(
  context: BindingContext,
  route: RouteDeclaration,
  method: string,
  placed: ReadonlySet<string>,
): CompiledBody {
  const selector = route.value.body ?? (bodyMethods.includes(method) ? "*" : "-");
  if (selector === "*") return { body: { kind: "parameters" }, requestMediaType: jsonMediaType };
  if (selector === "-") {
    checkEveryInputPlaced(context, placed, undefined);
    return { body: { kind: "none" }, requestMediaType: jsonMediaType };
  }
  const compiled = parameterBody(context, route, selector, placed);
  checkEveryInputPlaced(context, placed, selector);
  return compiled;
}

/**
 * Single-parameter body with its media type and exclusivity rules
 * @param context - Binding context of the operation
 * @param route - Route declaration holding the body selector
 * @param selector - Name of the input that is the body
 * @param placed - Input names that have a placement outside the body
 * @returns Body placement and media type
 */
function parameterBody(
  context: BindingContext,
  route: RouteDeclaration,
  selector: string,
  placed: ReadonlySet<string>,
): CompiledBody {
  const body: HttpBody = { kind: "parameter", parameter: selector };
  const field = context.input.fields.find((candidate) => candidate.name === selector);
  if (!field) {
    context.issue(
      "unknown-body-parameter",
      route.target,
      `No body parameter named ${JSON.stringify(selector)}`,
    );
    return { body, requestMediaType: jsonMediaType };
  }
  if (placed.has(selector)) {
    context.issue(
      "duplicate-body-placement",
      route.target,
      `Body parameter ${selector} is also mapped outside the body`,
    );
    return { body, requestMediaType: jsonMediaType };
  }
  if (!isBytes(field.type, context.types)) return { body, requestMediaType: jsonMediaType };
  if (field.type.nullable)
    context.issue(
      "nullable-binary-body",
      route.target,
      "A raw binary request body cannot distinguish JSON null from bytes",
    );
  return { body, requestMediaType: binaryMediaType };
}

/**
 * Every input needs a placement outside the body unless it is the body itself
 * @param context - Binding context of the operation
 * @param placed - Input names that have a placement outside the body
 * @param bodyParameter - Name of the body input, when a single parameter is the body
 */
function checkEveryInputPlaced(
  context: BindingContext,
  placed: ReadonlySet<string>,
  bodyParameter: string | undefined,
): void {
  for (const field of context.input.fields) {
    if (!placed.has(field.name) && field.name !== bodyParameter)
      context.issue(
        "missing-parameter-binding",
        context.operation,
        `Input ${field.name} has no HTTP placement`,
      );
  }
}
