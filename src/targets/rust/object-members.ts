import type { Field } from "../../model/contract-model.js";
import { useBody } from "./checks.js";
import type { RustContext } from "./context.js";
import { quote, snake } from "./naming.js";

/** Checks of one field inside the shared completion
 * @param ctx - Generation context
 * @param field - Resolved field
 * @returns Rust validation statements, or an empty string
 */
export function fieldChecks(ctx: RustContext, field: Field): string {
  const param = `field_${snake(field.name)}`;
  const body = useBody(ctx, field.type, "field_path");
  if (body === "") return "";
  const layers = 1 + (field.optional ? 1 : 0) + (field.type.nullable ? 1 : 0);
  return `if let ${"Some(".repeat(layers)}value${")".repeat(layers)} = &${param} { let field_path = state.child(path, ${quote(field.wireName)}); ${body} }`;
}
