import type { ObjectType } from "../../model/contract-model.js";
import { publicCodec } from "./codec-public.js";
import type { RustContext } from "./context.js";
import { docItem, key, snake } from "./naming.js";
import { fieldChecks } from "./object-members.js";
import { objectValue, renderObjectStorage } from "./render-storage.js";
import { fieldType } from "./storage.js";

/** Canonical object with immediate completion and private immutable ownership
 * @param ctx - Generation context
 * @param type - Object declaration
 * @returns Rust object declaration and codec entry points
 */
export function renderObject(ctx: RustContext, type: ObjectType): string {
  const params = type.fields.map((field) => `field_${snake(field.name)}: ${fieldType(ctx, field)}`);
  const supplied = type.fields.map((field) => `, Some(field_${snake(field.name)})`).join("");
  const completeParams = type.fields
    .map((field) => `, field_${snake(field.name)}: Option<${fieldType(ctx, field)}>`)
    .join("");
  const members = type.fields.map((field) => `${snake(field.name)}: field_${snake(field.name)}?`);
  const checks = type.fields
    .map((field) => fieldChecks(ctx, field))
    .filter(Boolean)
    .join("\n");
  const permission =
    '#[allow(clippy::too_many_arguments, reason = "one parameter per contract field")]';
  return `${renderObjectStorage(ctx, type)}
impl ${type.name} {
/// Owned construction without child graph revalidation
///
${type.fields.map((field) => `${docItem(`field_${snake(field.name)}`, field.description || `owned ${field.wireName} presence`)}\n`).join("")}/// - Return: complete accepted object
/// # Errors
/// Immediate field presence or use-site violations
${params.length > 7 ? `${permission}\n` : ""}pub fn try_new(${params.join(", ")}) -> Result<Accepted<Self>, ValidationFailure> {
    let mut state = State::default();
    let value = _complete_${key(type)}(0, &mut state${supplied});
    state.finish(value)
}
}
/// Completion of already-decoded immediate members
///
/// - path: parent path index
/// - state: validation accumulator
/// - members: supplied values or failed member decodes
/// - Return: complete candidate or missing member failure
${type.fields.length + 2 > 7 ? `${permission}\n` : ""}fn _complete_${key(type)}(${checks ? "path" : "_path"}: _Path, ${checks ? "state" : "_state"}: &mut State${completeParams}) -> Option<${type.name}> {
    ${checks}
    Some(${objectValue(type, members)})
}
${publicCodec(type)}`;
}
