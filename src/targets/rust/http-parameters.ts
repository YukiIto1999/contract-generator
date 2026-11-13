import type { Field, ScalarKind } from "../../model/contract-model.js";
import { constantValue } from "./constants.js";
import { node, type RustContext } from "./context.js";
import { quote } from "./naming.js";
import { literalJson } from "./storage.js";

/** Scalar meanings whose HTTP text spelling is a JSON number or boolean token */
const tokenKinds: Readonly<Partial<Record<ScalarKind, true>>> = {
  boolean: true,
  int32: true,
  int64: true,
  uint64: true,
  integer: true,
  decimal: true,
  float32: true,
  float64: true,
};

/** Effective HTTP representation of a nonbody placement
 * @param ctx - Rendering context
 * @param field - Canonical input member
 * @returns Scalar HTTP representation
 */
function fieldEncoding(ctx: RustContext, field: Field): string {
  const type = node(ctx, field.type.id);
  return field.type.encodings?.http ?? (type.kind === "scalar" ? type.encodings.http : "json");
}

/** Primitive HTTP parameter extraction through the adopted parser
 * @param ctx - Rendering context
 * @param field - Canonical input member
 * @returns Rust expression converting the received `text` to a JSON value
 */
export function parameterValue(ctx: RustContext, field: Field): string {
  const type = node(ctx, field.type.id);
  const reparsed =
    "match parse_json(&text) { Ok(mut parsed) if parsed.nodes.len() == 1 => parsed.take(parsed.root), _ => _JsonNode::String(text) }";
  if (type.kind === "literal" || type.kind === "enum") {
    const members =
      type.kind === "literal" ? [type.value] : type.members.map((member) => member.value);
    const arms = members.map(
      (value) =>
        `${quote(value.kind === "string" ? value.value : literalJson(value))} => ${constantValue(value)},`,
    );
    return `match text.as_str() { ${arms.join(" ")} _ => ${reparsed} }`;
  }
  const token =
    type.kind === "scalar" &&
    tokenKinds[type.scalar] === true &&
    fieldEncoding(ctx, field) !== "string";
  return token ? reparsed : "_JsonNode::String(text)";
}
