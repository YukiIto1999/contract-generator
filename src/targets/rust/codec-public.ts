import type { ContractType } from "../../model/contract-model.js";
import { key } from "./naming.js";

/** Public codec functions for one canonical declaration
 * @param type - Resolved declaration
 * @param guard - Statements asserting that an unvalidated value is acceptable before it is encoded, or an empty string
 * @returns Rust entry points
 */
export function publicCodec(type: ContractType, guard = ""): string {
  const id = key(type);
  return `
/// Exact JSON boundary decoding for ${type.name}
///
/// - source: complete JSON text
/// - binding: selected wire interpretation
/// - Return: complete value with diagnostics
/// # Errors
/// Syntax or contract violations without a partial value
pub fn decode_${id}(source: &str, binding: Binding) -> Result<Accepted<${type.name}>, ValidationFailure> {
    decode_${id}_value(parse_json(source)?, binding)
}
/// Owned parsed JSON boundary decoding for ${type.name}
///
/// - value: adopted parser output
/// - binding: selected wire interpretation
/// - Return: complete value with diagnostics
/// # Errors
/// Contract violations without a partial value
pub fn decode_${id}_value(value: Value, binding: Binding) -> Result<Accepted<${type.name}>, ValidationFailure> {
    let mut state = State::default();
    let value = _decode_${id}(value, binding, None, "", &mut state);
    state.finish(value)
}
/// Canonical JSON encoding without unknown-member retransmission
///
/// - value: validated value reference
/// - binding: selected wire interpretation
/// - Return: exact binding JSON
/// # Panics
/// A value that bypassed validated construction
pub fn encode_${id}(value: &${type.name}, binding: Binding) -> String { encode_${id}_value(value, binding).to_string() }
/// Parsed JSON encoding of an immutable accepted value
///
/// - value: validated value reference
/// - binding: selected wire interpretation
/// - Return: binding-local JSON value
/// # Panics
/// A value that bypassed validated construction
pub fn encode_${id}_value(value: &${type.name}, binding: Binding) -> Value {
    ${guard}
    _encode_${id}(value, binding, None)
}
`;
}
