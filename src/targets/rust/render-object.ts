import type { ObjectType } from "../../model/contract-model.js";
import { publicCodec } from "./codec-public.js";
import type { RustContext } from "./context.js";
import { doc, docItem, key, snake } from "./naming.js";
import { decodeField, encodeMember, fieldChecks } from "./object-members.js";
import { fieldType } from "./storage.js";

/** Largest parameter count that clippy accepts without a justification */
const maxArguments = 7;

/** Lint justification for a generated tuple that carries every contract field
 * @param fields - Number of tuple members
 * @returns Attribute allowing the generated shape, or an empty string for a short tuple
 */
export function tuplePermission(fields: number): string {
  return fields > 4
    ? '#[allow(clippy::type_complexity, reason = "one tuple member per contract field")]'
    : "";
}

/** Lint justification for generated functions that take one parameter per contract field
 * @param parameters - Number of parameters of the function
 * @returns Attribute allowing the generated shape, or an empty string within the clippy limit
 */
function widePermission(parameters: number): string {
  return parameters > maxArguments
    ? '#[allow(clippy::too_many_arguments, reason = "one parameter per contract field")]'
    : "";
}

/** Public struct and constructor of an object
 * @param ctx - Generation context
 * @param type - Object declaration
 * @returns Rust struct with an impl block holding the constructor
 */
function constructor(ctx: RustContext, type: ObjectType): string {
  const members = type.fields.map(
    (field) =>
      `${doc(field.description, `Accepted ${field.wireName} presence state`)}\n${snake(field.name)}: ${fieldType(ctx, field)},`,
  );
  const params = type.fields.map((field) => `field_${snake(field.name)}: ${fieldType(ctx, field)}`);
  const docs = type.fields.map((field) =>
    docItem(
      `field_${snake(field.name)}`,
      field.description || `owned ${field.wireName} presence state`,
    ),
  );
  const some = type.fields.map((field) => `, Some(field_${snake(field.name)})`).join("");
  const contract = [
    "/// Owned construction through the shared completion without child graph revalidation",
    "///",
    ...docs,
    "/// - Return: complete accepted object",
    "/// # Errors",
    "/// Field presence or use-site constraint violations",
    widePermission(params.length),
  ].filter((line) => line !== "");
  return `${doc(type.description, "Immutable accepted object with owned child storage")}
#[derive(Debug, Clone, PartialEq)]
pub struct ${type.name} { ${members.join("\n")} }
impl ${type.name} {
${contract.join("\n")}
pub fn try_new(${params.join(", ")}) -> Result<Accepted<Self>, ValidationFailure> {
    let mut state = State::default();
    let value = _complete_${key(type)}("", &mut state${some});
    state.finish(value)
}`;
}

/** Accessors and consuming extraction of an object
 * @param ctx - Generation context
 * @param type - Object declaration
 * @returns Rust methods closing the impl block opened by the constructor
 */
function accessors(ctx: RustContext, type: ObjectType): string {
  const methods = type.fields.map(
    (field) =>
      `/// Immutable accepted member reference\n///\n/// - self: validated parent\n/// - Return: member presence state\npub fn ${snake(field.name)}(&self) -> &${fieldType(ctx, field)} { &self.${snake(field.name)} }`,
  );
  const parts = type.fields.map((field) => `${fieldType(ctx, field)},`).join(" ");
  const moved = type.fields.map((field) => `self.${snake(field.name)},`).join(" ");
  const signature =
    type.fields.length === 0
      ? "pub fn into_parts(self) {}"
      : [
          tuplePermission(type.fields.length),
          `pub fn into_parts(self) -> (${parts}) { (${moved}) }`,
        ]
          .filter(Boolean)
          .join("\n");
  return `${methods.join("\n")}
/// Consuming member extraction without clones
///
/// - self: accepted parent
/// - Return: moved members in canonical field order
${signature}
}`;
}

/** Shared private completion of an object from already-decoded members
 * @param ctx - Generation context
 * @param type - Object declaration
 * @returns Rust private function used by both construction and decoding
 */
function completion(ctx: RustContext, type: ObjectType): string {
  const body = type.fields
    .map((field) => fieldChecks(ctx, field))
    .filter(Boolean)
    .join("\n");
  const params = type.fields.map(
    (field) => `, field_${snake(field.name)}: Option<${fieldType(ctx, field)}>`,
  );
  const construct = type.fields
    .map((field) => `${snake(field.name)}: field_${snake(field.name)}?`)
    .join(", ");
  const used = body !== "";
  const permission = widePermission(params.length + 2);
  return `/// Private completion shared by construction and decoding of ${type.name}
///
/// - path: parent pointer
/// - state: incomplete graph state
/// - members: decoded or supplied members, absent for a member that failed to decode
/// - Return: complete object, or none while any member is missing
${permission === "" ? "" : `${permission}\n`}fn _complete_${key(type)}(${used ? "path" : "_path"}: &str, ${used ? "state" : "_state"}: &mut State${params.join("")}) -> Option<${type.name}> {
    ${body}
    Some(${type.name} { ${construct} })
}
`;
}

/** Decoding of an object from adopted JSON through the shared completion
 * @param ctx - Generation context
 * @param type - Object declaration
 * @returns Rust private function
 */
function decoder(ctx: RustContext, type: ObjectType): string {
  const populated = type.fields.length > 0;
  const members = type.fields.map((field) => `, field_${snake(field.name)}`).join("");
  return `/// Single-pass object boundary decoding
///
/// - value: owned incoming JSON object
/// - binding: wire interpretation
/// - encoding: irrelevant object encoding
/// - path: parent pointer
/// - state: incomplete graph state
/// - Return: complete graph candidate
fn _decode_${key(type)}(value: Value, ${populated ? "binding" : "_binding"}: Binding, _encoding: Option<&str>, path: &str, state: &mut State) -> Option<${type.name}> {
    let ${populated ? "mut " : ""}object = object(value, path, state)?;
    ${type.fields.map((field) => decodeField(ctx, field)).join("\n")}
    unknown(object, path, state);
    _complete_${key(type)}(path, state${members})
}
`;
}

/** Object encoding without retained unknown members
 * @param ctx - Generation context
 * @param type - Object declaration
 * @returns Rust private function
 */
function encoder(ctx: RustContext, type: ObjectType): string {
  const populated = type.fields.length > 0;
  const inserts = type.fields.map((field) => encodeMember(ctx, field, "value", "object"));
  return `/// Object encoding without retained unknown members
///
/// - value: accepted parent
/// - binding: wire interpretation
/// - encoding: irrelevant object encoding
/// - Return: binding-local object
fn _encode_${key(type)}(${populated ? "value" : "_value"}: &${type.name}, ${populated ? "binding" : "_binding"}: Binding, _encoding: Option<&str>) -> Value {
    let ${populated ? "mut " : ""}object = Map::new();
    ${inserts.join("\n")}
    Value::Object(object)
}
`;
}

/** Canonical object with shared completion through private fields
 * @param ctx - Generation context
 * @param type - Object declaration
 * @returns Rust object declaration and codecs
 */
export function renderObject(ctx: RustContext, type: ObjectType): string {
  return `${constructor(ctx, type)}
${accessors(ctx, type)}
${completion(ctx, type)}${decoder(ctx, type)}${encoder(ctx, type)}${publicCodec(type)}`;
}
