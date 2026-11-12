import type { EnumType, LiteralType } from "../../model/contract-model.js";
import { publicCodec } from "./codec-public.js";
import { constantValue } from "./constants.js";
import { doc, key } from "./naming.js";
import { literalJson } from "./storage.js";

/** Public type and construction of a closed primitive set
 * @param type - Enumeration or literal declaration
 * @returns Rust declaration with its impl block
 */
function declaration(type: EnumType | LiteralType): string {
  const head = doc(type.description, "Closed exact primitive contract value");
  const body =
    type.kind === "literal"
      ? `pub struct ${type.name}(());`
      : `pub enum ${type.name} { ${type.members.map((member) => `${doc("", `Exact ${literalJson(member.value)} literal`)}\n${member.name},`).join("\n")} }`;
  return `${head}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
${body}
impl ${type.name} {
/// Exact literal construction through the shared codec
///
/// - value: candidate primitive JSON
/// - Return: accepted closed value
/// # Errors
/// Value outside the declared literal set
pub fn try_new(value: Value) -> Result<Accepted<Self>, ValidationFailure> { decode_${key(type)}_value(value, Binding::Ipc) }
}`;
}

/** Exact membership decoding of a closed primitive set
 * @param type - Enumeration or literal declaration
 * @returns Rust private function
 */
function decoder(type: EnumType | LiteralType): string {
  const members = type.kind === "literal" ? [{ name: "Value", value: type.value }] : type.members;
  const checks = members.map((member) => {
    const selected = type.kind === "literal" ? `${type.name}(())` : `${type.name}::${member.name}`;
    return `if literal_equal(&value, { static EXPECTED: std::sync::OnceLock<Value> = std::sync::OnceLock::new(); EXPECTED.get_or_init(|| ${constantValue(member.value)}) }) { return Some(${selected}); }`;
  });
  return `/// Exact literal-set decoding
///
/// - value: candidate JSON
/// - binding: representation-independent literal
/// - encoding: representation-independent literal
/// - path: member pointer
/// - state: incomplete graph state
/// - Return: selected literal candidate
fn _decode_${key(type)}(value: Value, _binding: Binding, _encoding: Option<&str>, path: &str, state: &mut State) -> Option<${type.name}> {
    ${checks.join("\n")}
    state.reject(path, if value.is_null() { "null" } else { "literal" });
    None
}
`;
}

/** Exact primitive token of a closed set value
 * @param type - Enumeration or literal declaration
 * @returns Rust private function
 */
function encoder(type: EnumType | LiteralType): string {
  const body =
    type.kind === "literal"
      ? constantValue(type.value)
      : `match value { ${type.members.map((member) => `${type.name}::${member.name} => ${constantValue(member.value)},`).join("\n")} }`;
  return `/// Exact literal encoding
///
/// - value: accepted closed value
/// - binding: representation-independent literal
/// - encoding: representation-independent literal
/// - Return: exact primitive token
fn _encode_${key(type)}(${type.kind === "literal" ? "_value" : "value"}: &${type.name}, _binding: Binding, _encoding: Option<&str>) -> Value {
    ${body}
}
`;
}

/** Literal and enum closed-set generation
 * @param type - Exact primitive declaration
 * @returns Rust closed type and codecs
 */
export function renderClosed(type: EnumType | LiteralType): string {
  return `${declaration(type)}
${decoder(type)}${encoder(type)}${publicCodec(type)}`;
}
