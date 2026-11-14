import type { ContractType } from "../../model/contract-model.js";
import { key } from "./naming.js";

/** Public text and byte codecs for one canonical declaration
 * @param type - Resolved declaration
 * @param guard - Assertions for an unwrapped scalar before encoding
 * @returns Rust entry points that never expose transient parser storage
 */
export function publicCodec(type: ContractType, guard = ""): string {
  const id = key(type);
  const leaf = type.kind === "scalar" || type.kind === "literal" || type.kind === "enum";
  return `
/// Complete JSON text or byte decoding without Unicode replacement
///
/// - source: complete UTF-8 JSON text or bytes
/// - binding: selected wire interpretation
/// - Return: complete value with diagnostics
/// # Errors
/// Invalid UTF-8, ambiguous JSON text, syntax or contract violations
pub fn decode_${id}(source: impl std::convert::AsRef<[u8]>, binding: Binding) -> Result<Accepted<${type.name}>, ValidationFailure> {
    let mut json = parse_json_bytes(source.as_ref())?;
    let root = json.root;
    let mut state = State::default();
    let value = _decode_${id}(&mut json, root, binding, None, 0, &mut state);
    state.finish(value)
}
/// Canonical JSON encoding without unknown-member retransmission
///
/// - value: validated value reference
/// - binding: selected wire interpretation
/// - Return: complete exact binding JSON
/// # Panics
/// A value that bypassed validated construction
pub fn encode_${id}(value: &${type.name}, binding: Binding) -> String {
    ${guard}
    _encode_${id}(value, binding, None)
}
${
  leaf
    ? `/// Private scalar JSON document encoding through library events
fn _encode_${id}(value: &${type.name}, binding: Binding, encoding: Option<&str>) -> String {
    let mut writer = _JsonWriter::new();
    _write_${id}(value, binding, encoding, &mut writer);
    writer.finish()
}
`
    : ""
}`;
}
