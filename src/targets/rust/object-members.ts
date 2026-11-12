import type { Field } from "../../model/contract-model.js";
import { useBody } from "./checks.js";
import { decodeUse, encodeUse } from "./codec-use.js";
import type { RustContext } from "./context.js";
import { quote, snake } from "./naming.js";

/** Checks of one field inside the shared completion
 * @param ctx - Generation context
 * @param field - Resolved field
 * @returns Rust validation statements, or an empty string
 */
export function fieldChecks(ctx: RustContext, field: Field): string {
  const param = `field_${snake(field.name)}`;
  const body = useBody(ctx, field.type, `&pointer(path, ${quote(field.wireName)})`);
  if (body === "") return "";
  const layers = 1 + (field.optional ? 1 : 0) + (field.type.nullable ? 1 : 0);
  return `if let ${"Some(".repeat(layers)}value${")".repeat(layers)} = &${param} { ${body} }`;
}

/** Field extraction, representation decoding and presence enforcement
 * @param ctx - Generation context
 * @param field - Resolved field
 * @returns Rust statement binding `field_<name>` to the decoded Option
 */
export function decodeField(ctx: RustContext, field: Field): string {
  const wire = quote(field.wireName);
  const path = `&pointer(path, ${wire})`;
  const decoded = decodeUse(ctx, field.type, "value", path);
  const presence = field.optional
    ? `match object.remove(${wire}) { None => Some(None), Some(value) => ${decoded}.map(Some) }`
    : `required(object.remove(${wire}), ${path}, state).and_then(|value| ${decoded})`;
  return `let field_${snake(field.name)} = ${presence};`;
}

/** Encoding of one field into a JSON object under construction
 * @param ctx - Generation context
 * @param field - Resolved field
 * @param owner - Rust expression of the borrowed accepted object
 * @param sink - Rust identifier of the mutable JSON object
 * @returns Rust statement inserting the member when present
 */
export function encodeMember(ctx: RustContext, field: Field, owner: string, sink: string): string {
  const insert = `${sink}.insert(${quote(field.wireName)}.into(), ${encodeUse(ctx, field.type, "member")});`;
  return field.optional
    ? `if let Some(member) = &${owner}.${snake(field.name)} { ${insert} }`
    : `{ let member = &${owner}.${snake(field.name)}; ${insert} }`;
}
