import type { TypeUse } from "../../model/contract-model.js";
import { needsBaseCheck } from "./checks.js";
import { node, type RustContext } from "./context.js";
import { key, quote } from "./naming.js";

/** Rust expression preceded by renaming statements that are omitted when they rename a variable to itself
 * @param bindings - Variable name and bound expression pairs
 * @param call - Final expression
 * @returns The call alone, or a block binding the renamed variables
 */
function scoped(bindings: readonly (readonly [string, string])[], call: string): string {
  const statements = bindings
    .filter(([name, expression]) => name !== expression)
    .map(([name, expression]) => `let ${name} = ${expression};`);
  return statements.length === 0 ? call : `{ ${statements.join(" ")} ${call} }`;
}

/** Binding-specific encoding override expression
 * @param use - Resolved type use
 * @returns Rust expression of the optional override
 */
function override(use: TypeUse): string {
  const http = use.encodings?.http;
  const ipc = use.encodings?.ipc;
  if (http === undefined && ipc === undefined) return "None";
  const arm = (encoding: string | undefined): string =>
    encoding === undefined ? "None" : `Some(${quote(encoding)})`;
  return `match binding { Binding::Http => ${arm(http)}, Binding::Ipc => ${arm(ipc)} }`;
}

/** Owned use-site decoding of the representation; the owner's completion applies the checks
 * @param ctx - Resolved generation context
 * @param use - Resolved use semantics
 * @param expression - Owned incoming JSON
 * @param path - Pointer expression
 * @returns Rust Option expression of the use storage
 */
export function decodeUse(
  ctx: RustContext,
  use: TypeUse,
  expression: string,
  path: string,
): string {
  const type = node(ctx, use.id);
  const decoder = needsBaseCheck(type) ? "_parse_" : "_decode_";
  const boxed = ctx.boxed.has(use) ? ".map(Box::new)" : "";
  const call = `${decoder}${key(type)}(value, binding, ${override(use)}, path, state)${boxed}`;
  return use.nullable
    ? `nullable(${expression}, ${path}, state, |value, path, state| ${call})`
    : scoped(
        [
          ["value", expression],
          ["path", path],
        ],
        call,
      );
}

/** Borrowed use-site encoding without revalidation or graph cloning
 * @param ctx - Resolved generation context
 * @param use - Resolved use semantics
 * @param expression - Borrowed accepted value
 * @returns Rust JSON expression
 */
export function encodeUse(ctx: RustContext, use: TypeUse, expression: string): string {
  const call = `_encode_${key(node(ctx, use.id))}(value, binding, ${override(use)})`;
  return use.nullable
    ? `match ${expression} { Some(value) => ${call}, None => Value::Null }`
    : scoped([["value", expression]], call);
}
