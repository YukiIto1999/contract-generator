import type { ObjectType } from "../../model/contract-model.js";
import type { RustContext } from "./context.js";
import { doc, snake } from "./naming.js";
import { fieldType } from "./storage.js";

/** Canonical immutable object storage with allocation-preserving extraction
 * @param ctx - Resolved rendering context
 * @param type - Canonical member declaration
 * @param name - Public canonical or provider-effective name
 * @param effective - Required presence of defaulted input members
 * @returns Rust storage declaration and borrowed accessors
 */
export function renderObjectStorage(
  ctx: RustContext,
  type: ObjectType,
  name = type.name,
  effective = false,
): string {
  const shared = ctx.shared.has(type.id);
  return `${renderObjectDeclaration(ctx, type, name, effective, shared)}
${renderObjectOwnership(name, shared)}
${renderObjectAccess(ctx, type, name, effective)}
${shared ? `impl Drop for ${name} { fn drop(&mut self) { if let Some(data) = self.0.take() { _drop_graph(_Drop::${name}(data)); } } }` : ""}
`;
}

/** Canonical object handle and member storage declarations
 * @param ctx - Rendering context
 * @param type - Object declaration
 * @param name - Canonical or provider-effective name
 * @param effective - Required defaulted member presence
 * @param shared - Shared ownership requirement
 * @returns Rust storage declarations
 */
function renderObjectDeclaration(
  ctx: RustContext,
  type: ObjectType,
  name: string,
  effective: boolean,
  shared: boolean,
): string {
  const data = `_${name}Data`;
  const fields = type.fields
    .map(
      (field) =>
        `${doc(field.description, "Accepted member presence")}\n${snake(field.name)}: ${fieldType(ctx, field, effective)},`,
    )
    .join("\n");
  return `${doc(type.description, "Immutable accepted object")}
#[derive(Clone)]
pub struct ${name}(
/// Private immutable member ownership
${shared ? `Option<std::sync::Arc<${data}>>` : data}
);
/// Private immediate member storage
#[derive(Clone)]
struct ${data} { ${fields} }`;
}

/** Canonical member-shell ownership operations
 * @param name - Canonical or provider-effective name
 * @param shared - Shared ownership requirement
 * @returns Rust ownership construction and extraction functions
 */
function renderObjectOwnership(name: string, shared: boolean): string {
  const data = `_${name}Data`;
  return `/// Canonical ownership of completed immediate members
///
/// - data: accepted member storage
/// - Return: immutable canonical handle
fn __from_data_${snake(name)}(data: ${data}) -> ${name} { ${name}(${shared ? "Some(std::sync::Arc::new(data))" : "data"}) }
/// Borrowed immediate member storage
///
/// - value: live canonical handle
/// - Return: immutable member shell
${shared ? "/// # Panics\n/// Broken internal canonical ownership invariant\n" : ""}fn __data_${snake(name)}(value: &${name}) -> &${data} { ${shared ? 'match value.0.as_deref() { Some(data) => data, None => panic!("broken canonical ownership invariant") }' : "&value.0"} }
/// Owned immediate member storage
///
/// - value: canonical handle
/// - Return: moved unique shell or cloned shared shell
${shared ? "/// # Panics\n/// Broken internal canonical ownership invariant\n" : ""}fn __into_data_${snake(name)}(${shared ? "mut " : ""}value: ${name}) -> ${data} { ${shared ? `let data = match value.0.take() { Some(data) => data, None => panic!("broken canonical ownership invariant") }; match std::sync::Arc::try_unwrap(data) { Ok(data) => data, Err(data) => { let result = (*data).clone(); _drop_graph(_Drop::${name}(data)); result } }` : "value.0"} }
`;
}

/** Immutable member access and consuming field extraction
 * @param ctx - Rendering context
 * @param type - Object declaration
 * @param name - Canonical or provider-effective name
 * @param effective - Required defaulted member presence
 * @returns Rust public member access implementation
 */
function renderObjectAccess(
  ctx: RustContext,
  type: ObjectType,
  name: string,
  effective: boolean,
): string {
  const getters = type.fields
    .map(
      (field) => `/// Immutable accepted member reference
///
/// - self: accepted parent
/// - Return: borrowed member presence
pub fn ${snake(field.name)}(&self) -> &${fieldType(ctx, field, effective)} { &__data_${snake(name)}(self).${snake(field.name)} }`,
    )
    .join("\n");
  const parts = type.fields.map((field) => `${fieldType(ctx, field, effective)},`).join(" ");
  const moved = type.fields.map((field) => `data.${snake(field.name)},`).join(" ");
  const extraction =
    type.fields.length === 0
      ? ` { __into_data_${snake(name)}(self); }`
      : ` -> (${parts}) { let data = __into_data_${snake(name)}(self); (${moved}) }`;
  return `impl ${name} {
${getters}
/// Consuming member extraction with unique allocation preservation
///
/// - self: accepted parent
/// - Return: owned immediate members in canonical field order
${type.fields.length > 4 ? '#[allow(clippy::type_complexity, reason = "one tuple member per contract field")]\n' : ""}pub fn into_parts(self)${extraction}
}`;
}

/** Completed object expression behind the canonical private storage
 * @param type - Object declaration
 * @param members - Rust named member initializers
 * @param name - Canonical or provider-effective declaration name
 * @returns Rust object construction expression
 */
export function objectValue(
  type: ObjectType,
  members: readonly string[],
  name = type.name,
): string {
  return `__from_data_${snake(name)}(_${name}Data { ${members.join(", ")} })`;
}
