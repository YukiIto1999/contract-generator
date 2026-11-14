import type { EnumType, Literal, LiteralType } from "../../model/contract-model.js";
import { publicCodec } from "./codec-public.js";
import { constantValue } from "./constants.js";
import { doc, key, quote } from "./naming.js";
import { literalJson } from "./storage.js";

/** Native primitive parameter and token for a single literal constructor
 * @param value - Declared primitive
 * @returns Native parameter type and its flat token construction
 */
function primitive(value: Literal): readonly [string, string] {
  switch (value.kind) {
    case "string":
      return ["String", "_JsonNode::String(value)"];
    case "number":
      return ["ExactNumber", "_JsonNode::Number(value.0)"];
    case "boolean":
      return ["bool", "_JsonNode::Bool(value)"];
    case "null":
      return ["()", "_JsonNode::Null"];
  }
}

/** Public closed value and primitive-typed literal construction
 * @param type - Enumeration or literal declaration
 * @returns Rust nominal declaration
 */
function declaration(type: EnumType | LiteralType): string {
  const head = doc(type.description, "Closed exact primitive contract value");
  if (type.kind === "enum")
    return `${head}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ${type.name} { ${type.members.map((member) => `${doc("", `Exact ${literalJson(member.value)} literal`)}\n${member.name},`).join("\n")} }
`;
  const [raw, token] = primitive(type.value);
  return `${head}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ${type.name}(());
impl ${type.name} {
/// Exact literal construction from native primitive storage
///
/// - value: candidate primitive
/// - Return: accepted closed value
/// # Errors
/// A primitive unequal to the declared literal
pub fn try_new(${type.value.kind === "null" ? "_value" : "value"}: ${raw}) -> Result<Accepted<Self>, ValidationFailure> {
    let mut state = State::default();
    let value = _closed_${key(type)}(&${token}, 0, &mut state);
    state.finish(value)
}
}
`;
}

/** Membership checking shared by native construction and JSON decoding
 * @param type - Enumeration or literal declaration
 * @returns Private typed decoding functions
 */
function decoder(type: EnumType | LiteralType): string {
  const members = type.kind === "literal" ? [{ name: "Value", value: type.value }] : type.members;
  const checks = members.map((member) => {
    const selected = type.kind === "literal" ? `${type.name}(())` : `${type.name}::${member.name}`;
    return `if literal_equal(value, { static EXPECTED: std::sync::OnceLock<_JsonNode> = std::sync::OnceLock::new(); EXPECTED.get_or_init(|| ${constantValue(member.value)}) }) { return Some(${selected}); }`;
  });
  return `/// Exact primitive membership without recursive JSON ownership
fn _closed_${key(type)}(value: &_JsonNode, path: _Path, state: &mut State) -> Option<${type.name}> {
    ${checks.join("\n")}
    state.reject(path, if value.is_null() { "null" } else { "literal" });
    None
}
/// Decode one flat primitive token into an exhaustive closed value
fn _decode_${key(type)}(json: &mut _Json, node: usize, _binding: Binding, _encoding: Option<&str>, path: _Path, state: &mut State) -> Option<${type.name}> {
    _closed_${key(type)}(&json.take(node), path, state)
}
`;
}

/** Borrowed writer statement for a known primitive literal
 * @param value - Declared literal
 * @returns Rust event writer call
 */
function writeLiteral(value: Literal): string {
  switch (value.kind) {
    case "string":
      return `writer.string(${quote(value.value)});`;
    case "number":
      return `writer.number(${quote(value.text)});`;
    case "boolean":
      return `writer.boolean(${value.value});`;
    case "null":
      return "writer.null();";
  }
}

/** Exact primitive encoding through the adopted event writer
 * @param type - Enumeration or literal declaration
 * @returns Private borrowed writer
 */
function encoder(type: EnumType | LiteralType): string {
  const body =
    type.kind === "literal"
      ? writeLiteral(type.value)
      : `match value { ${type.members.map((member) => `${type.name}::${member.name} => { ${writeLiteral(member.value)} },`).join("\n")} }`;
  return `/// Write an exact closed primitive without allocating an intermediate token
fn _write_${key(type)}(${type.kind === "literal" ? "_value" : "value"}: &${type.name}, _binding: Binding, _encoding: Option<&str>, writer: &mut _JsonWriter) {
    ${body}
}
`;
}

/** Literal and enum closed-set generation
 * @param type - Exact primitive declaration
 * @returns Rust closed type and codecs
 */
export function renderClosed(type: EnumType | LiteralType): string {
  return `${declaration(type)}${decoder(type)}${encoder(type)}${publicCodec(type)}`;
}
