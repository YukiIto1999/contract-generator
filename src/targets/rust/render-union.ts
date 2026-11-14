import type { UnionType } from "../../model/contract-model.js";
import { encodeUse } from "./codec-use.js";
import { publicCodec } from "./codec-public.js";
import { node, type RustContext } from "./context.js";
import { doc, key, quote, snake } from "./naming.js";
import { useType } from "./storage.js";
import { tupleVariant } from "./render-enum.js";

/** Inline exhaustive union of canonical immutable object handles
 * @param ctx - Generation context
 * @param type - Union declaration
 * @returns Rust declarations and immediate discriminator completion
 */
export function renderUnion(ctx: RustContext, type: UnionType): string {
  const cases = type.variants
    .map((variant) =>
      tupleVariant(variant.name, `Payload for exact tag ${variant.tag}`, [
        [useType(ctx, variant.type), "Canonical accepted payload"],
      ]),
    )
    .join("\n");
  return `${doc(type.description, "Closed accepted discriminator-selected value")}
#[derive(Clone)]
pub struct ${type.name}(
/// Selected accepted union case
${type.name}Case
);
/// Exhaustive accepted union cases
#[derive(Clone)]
pub enum ${type.name}Case { ${cases} }
impl ${type.name} {
/// Discriminator-correct owned construction without child graph revalidation
///
/// - value: owned accepted payload case
/// - Return: validated matching discriminator
/// # Errors
/// Payload discriminator inconsistent with selected case
pub fn try_new(value: ${type.name}Case) -> Result<Accepted<Self>, ValidationFailure> {
    let mut state = State::default();
    let value = _complete_${key(type)}(0, &mut state, value);
    state.finish(value)
}
/// Shared exhaustive case view
///
/// - self: accepted union
/// - Return: borrowed selected payload
pub fn as_case(&self) -> &${type.name}Case { &self.0 }
/// Consuming exhaustive case extraction
///
/// - self: accepted union
/// - Return: moved selected payload
pub fn into_case(self) -> ${type.name}Case { self.0 }
}
${renderUnionCompletion(ctx, type)}
${publicCodec(type)}`;
}

/** Immediate selected-case discriminator validation
 * @param ctx - Rendering context
 * @param type - Union declaration
 * @returns Rust discriminator completion function
 */
function renderUnionCompletion(ctx: RustContext, type: UnionType): string {
  const checks = type.variants
    .map((variant) => {
      const payload = node(ctx, variant.type.id);
      const field =
        payload.kind === "object"
          ? payload.fields.find((candidate) => candidate.wireName === type.discriminator)
          : undefined;
      if (field === undefined) return `${type.name}Case::${variant.name}(_) => {},`;
      const encoded = encodeUse(ctx, field.type, `payload.${snake(field.name)}()`);
      return `${type.name}Case::${variant.name}(payload) => { let binding = Binding::Ipc; if ${encoded} != ${quote(JSON.stringify(variant.tag))} { let path = state.child(path, ${quote(type.discriminator)}); state.reject(path, "variant"); } },`;
    })
    .join("\n");
  return `/// Immediate discriminator completion
///
/// - path: union path index
/// - state: validation accumulator
/// - value: selected case
/// - Return: matching union candidate
fn _complete_${key(type)}(path: _Path, state: &mut State, value: ${type.name}Case) -> Option<${type.name}> {
    match &value { ${checks} }
    Some(${type.name}(value))
}`;
}
