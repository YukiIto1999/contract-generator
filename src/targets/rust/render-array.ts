import type { ArrayType } from "../../model/contract-model.js";
import { completeUse, optional } from "./checks.js";
import { publicCodec } from "./codec-public.js";
import type { RustContext } from "./context.js";
import { doc, key } from "./naming.js";
import { useType } from "./storage.js";

/** Immutable shared array with immediate completion and ownership-preserving extraction
 * @param ctx - Generation context
 * @param type - Array declaration
 * @returns Rust declaration and public codec
 */
export function renderArray(ctx: RustContext, type: ArrayType): string {
  const element = useType(ctx, type.element);
  return `${doc(type.description, "Immutable shared collection of accepted child values")}
#[derive(Clone)]
pub struct ${type.name}(
/// Private immutable element ownership
Option<std::sync::Arc<Vec<${element}>>>
);
impl ${type.name} {
/// Collection ownership transfer without descendant revalidation
///
/// - value: owned accepted child values
/// - Return: complete immutable array
/// # Errors
/// Cardinality or immediate element use-site violations
pub fn try_new(value: Vec<${element}>) -> Result<Accepted<Self>, ValidationFailure> {
    let mut state = State::default();
    let value = _complete_${key(type)}(value, 0, &mut state);
    state.finish(Some(value))
}
${renderArrayAccess(type, element)}
}
impl Drop for ${type.name} { fn drop(&mut self) { if let Some(value) = self.0.take() { _drop_graph(_Drop::${type.name}(value)); } } }
${renderArrayCompletion(ctx, type, element)}
${publicCodec(type)}`;
}

/** Borrowed and consuming collection access
 * @param type - Array declaration
 * @param element - Accepted element storage
 * @returns Rust collection access methods
 */
function renderArrayAccess(type: ArrayType, element: string): string {
  return `/// Shared immutable collection view
///
/// - self: accepted collection
/// - Return: borrowed accepted elements
/// # Panics
/// Broken internal canonical ownership invariant
pub fn as_slice(&self) -> &[${element}] { match self.0.as_deref() { Some(value) => value, None => panic!("broken canonical ownership invariant") } }
/// Consuming collection extraction with unique allocation preservation
///
/// - self: accepted collection
/// - Return: moved unique vector or copied shared element shell
/// # Panics
/// Broken internal canonical ownership invariant
pub fn into_vec(mut self) -> Vec<${element}> {
    let value = match self.0.take() { Some(value) => value, None => panic!("broken canonical ownership invariant") };
    match std::sync::Arc::try_unwrap(value) { Ok(value) => value, Err(value) => { let result = (*value).clone(); _drop_graph(_Drop::${type.name}(value)); result } }
}
`;
}

/** Immediate collection validation and ownership
 * @param ctx - Rendering context
 * @param type - Array declaration
 * @param element - Accepted element storage
 * @returns Rust completion function
 */
function renderArrayCompletion(ctx: RustContext, type: ArrayType, element: string): string {
  const member = completeUse(ctx, type.element, "member", "member_path");
  const { minItems, maxItems } = type.constraints;
  const bounded = minItems !== undefined || maxItems !== undefined;
  const check = `${bounded ? `check_items(value.len(), ${optional(minItems)}, ${optional(maxItems)}, path, state);` : ""}
${member ? `for (index, member) in value.iter().enumerate() { let member_path = state.child(path, index.to_string()); ${member} }` : ""}`;
  return `/// Immediate collection completion
///
/// - value: accepted element storage
/// - path: array path index
/// - state: validation accumulator
/// - Return: immutable canonical collection
fn _complete_${key(type)}(value: Vec<${element}>, ${bounded || member ? "path" : "_path"}: _Path, ${bounded || member ? "state" : "_state"}: &mut State) -> ${type.name} {
    ${check}
    ${type.name}(Some(std::sync::Arc::new(value)))
}`;
}
