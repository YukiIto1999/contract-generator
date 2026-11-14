import type { TypeUse } from "../../model/contract-model.js";
import { needsBaseCheck } from "./checks.js";
import { node, type RustContext } from "./context.js";
import { key, quote } from "./naming.js";

/** Binding-specific encoding override
 * @param use - Resolved type use
 * @returns Rust expression of the optional override
 */
export function encodingOverride(use: TypeUse): string {
  const http = use.encodings?.http;
  const ipc = use.encodings?.ipc;
  if (http === undefined && ipc === undefined) return "None";
  const arm = (encoding: string | undefined): string =>
    encoding === undefined ? "None" : `Some(${quote(encoding)})`;
  return `match binding { Binding::Http => ${arm(http)}, Binding::Ipc => ${arm(ipc)} }`;
}

/** Use-site decoding from a private flat JSON node
 * @param ctx - Resolved generation context
 * @param use - Resolved use semantics
 * @param expression - Node index in the mutable json input
 * @param path - Path index expression
 * @returns Rust Option expression of the canonical use storage
 */
export function decodeUse(
  ctx: RustContext,
  use: TypeUse,
  expression: string,
  path: string,
): string {
  const type = node(ctx, use.id);
  const decoder = needsBaseCheck(type) ? "_parse_" : "_decode_";
  const call = `${decoder}${key(type)}(json, value, binding, ${encodingOverride(use)}, path, state)`;
  const decoded = use.nullable
    ? `if matches!(json.nodes[value], _JsonNode::Null) { Some(None) } else { ${call}.map(Some) }`
    : call;
  if (expression === "value" && path === "path") return decoded;
  return `{ ${expression === "value" ? "" : `let value = ${expression};`} ${path === "path" ? "" : `let path = ${path};`} ${decoded} }`;
}

/** Borrowed use-site encoding without a retained JSON tree
 * @param ctx - Resolved generation context
 * @param use - Resolved use semantics
 * @param expression - Borrowed accepted value
 * @returns Rust JSON text expression
 */
export function encodeUse(ctx: RustContext, use: TypeUse, expression: string): string {
  const type = node(ctx, use.id);
  const call =
    type.kind === "object" || type.kind === "array" || type.kind === "union"
      ? `_encode_${key(type)}(value, binding, ${encodingOverride(use)})`
      : `{ let mut writer = _JsonWriter::new(); _write_${key(type)}(value, binding, ${encodingOverride(use)}, &mut writer); writer.finish() }`;
  return use.nullable
    ? `match ${expression} { Some(value) => ${call}, None => "null".to_owned() }`
    : expression === "value"
      ? call
      : `{ let value = ${expression}; ${call} }`;
}
