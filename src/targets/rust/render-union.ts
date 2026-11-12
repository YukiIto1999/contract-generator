import type { UnionType, Variant } from "../../model/contract-model.js";
import { decodeUse, encodeUse } from "./codec-use.js";
import { publicCodec } from "./codec-public.js";
import { node, type RustContext } from "./context.js";
import { doc, key, quote, snake } from "./naming.js";
import { useType } from "./storage.js";

/** Discriminator consistency check of one case inside the shared completion
 * @param ctx - Generation context
 * @param type - Union declaration
 * @param variant - Union case
 * @returns Rust match arm, or an empty string when the payload carries no discriminator field
 */
function caseCheck(ctx: RustContext, type: UnionType, variant: Variant): string {
  const payload = node(ctx, variant.type.id);
  if (payload.kind !== "object") return "";
  const field = payload.fields.find((candidate) => candidate.wireName === type.discriminator);
  if (field === undefined) return "";
  const encoded = encodeUse(ctx, field.type, `&payload.${snake(field.name)}`);
  const expected = `Value::String(${quote(variant.tag)}.into())`;
  return `${type.name}Case::${variant.name}(payload) => { let binding = Binding::Ipc; if ${encoded} != ${expected} { state.reject(&pointer(path, ${quote(type.discriminator)}), "variant"); } },`;
}

/** Public structs, constructor and accessors of a union
 * @param ctx - Generation context
 * @param type - Union declaration
 * @returns Rust declarations with the impl block
 */
function declaration(ctx: RustContext, type: UnionType): string {
  const cases = type.variants
    .map(
      (variant) =>
        `${doc("", `Payload for exact tag ${variant.tag}`)}\n${variant.name}(${useType(ctx, variant.type)}),`,
    )
    .join("\n");
  return `${doc(type.description, "Closed accepted discriminator-selected value")}
#[derive(Debug, Clone, PartialEq)]
pub struct ${type.name}(${type.name}Case);
/// Exhaustive accepted union cases
#[derive(Debug, Clone, PartialEq)]
pub enum ${type.name}Case { ${cases} }
impl ${type.name} {
/// Discriminator-correct owned union construction through the shared completion
///
/// - value: owned accepted payload case
/// - Return: validated matching discriminator
/// # Errors
/// Payload discriminator inconsistent with selected case
pub fn try_new(value: ${type.name}Case) -> Result<Accepted<Self>, ValidationFailure> {
    let mut state = State::default();
    let value = _complete_${key(type)}("", &mut state, value);
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
}`;
}

/** Discriminator-first selection and shared completion of a union
 * @param ctx - Generation context
 * @param type - Union declaration
 * @returns Rust private functions
 */
function codecFunctions(ctx: RustContext, type: UnionType): string {
  const id = key(type);
  const tags = type.variants
    .map((variant, index) => `Some(${quote(variant.tag)}) => ${index},`)
    .join(" ");
  const arms = type.variants
    .map(
      (variant, index) =>
        `${index} => ${decodeUse(ctx, variant.type, "value", "path")}.map(${type.name}Case::${variant.name}),`,
    )
    .join("\n");
  return `/// Private completion shared by construction and decoding of ${type.name}
///
/// - path: union pointer
/// - state: incomplete graph state
/// - value: selected case
/// - Return: union whose payload carries the discriminator of its case
fn _complete_${id}(path: &str, state: &mut State, value: ${type.name}Case) -> Option<${type.name}> {
    match &value { ${type.variants.map((variant) => caseCheck(ctx, type, variant)).join("\n")} }
    Some(${type.name}(value))
}
/// Discriminator-first single-pass decoding
///
/// - value: incoming JSON
/// - binding: wire interpretation
/// - encoding: irrelevant union encoding
/// - path: union pointer
/// - state: incomplete graph state
/// - Return: selected accepted payload
fn _decode_${id}(value: Value, binding: Binding, _encoding: Option<&str>, path: &str, state: &mut State) -> Option<${type.name}> {
    if !value.is_object() { state.reject(path, if value.is_null() { "null" } else { "type" }); return None; }
    let selected = match value.get(${quote(type.discriminator)}).and_then(Value::as_str) { ${tags} _ => usize::MAX };
    let case = match selected { ${arms}
      _ => { state.reject(&pointer(path, ${quote(type.discriminator)}), "variant"); None }
    };
    _complete_${id}(path, state, case?)
}
`;
}

/** Selected union payload encoding
 * @param ctx - Generation context
 * @param type - Union declaration
 * @returns Rust private function
 */
function encoder(ctx: RustContext, type: UnionType): string {
  const arms = type.variants.map(
    (variant) =>
      `${type.name}Case::${variant.name}(value) => ${encodeUse(ctx, variant.type, "value")},`,
  );
  return `/// Selected union payload encoding
///
/// - value: accepted union
/// - binding: wire interpretation
/// - encoding: irrelevant union encoding
/// - Return: discriminator-bearing payload
fn _encode_${key(type)}(value: &${type.name}, binding: Binding, _encoding: Option<&str>) -> Value {
    match &value.0 { ${arms.join("\n")} }
}
`;
}

/** Closed discriminator-selected union with constrained construction
 * @param ctx - Generation context
 * @param type - Union declaration
 * @returns Rust declaration and codecs
 */
export function renderUnion(ctx: RustContext, type: UnionType): string {
  return `${declaration(ctx, type)}
${codecFunctions(ctx, type)}${encoder(ctx, type)}${publicCodec(type)}`;
}
