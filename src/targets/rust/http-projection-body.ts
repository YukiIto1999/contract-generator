import type { Field } from "../../model/contract-model.js";
import { hasBaseChecks } from "./checks.js";
import { decodeUse, encodeUse } from "./codec-use.js";
import { node, type RustContext } from "./context.js";
import type { HttpProjectionPlan } from "./http-projection-plan.js";
import { key, quote, snake } from "./naming.js";

/** Raw body field completion without a binary text roundtrip
 * @param ctx - Rendering context
 * @param field - Raw body field
 * @returns Field candidate binding
 */
function rawMember(ctx: RustContext, field: Field): string {
  const scalar = node(ctx, field.type.id);
  const role =
    scalar.kind === "scalar" && scalar.role !== null ? node(ctx, scalar.role).name : undefined;
  const check =
    scalar.kind === "scalar" && scalar.role === scalar.id && hasBaseChecks(scalar)
      ? `_check_${key(scalar)}(&value, path, state);`
      : "";
  return `let field_${snake(field.name)} = { ${!field.optional || check !== "" ? `let path = state.child(0, ${quote(field.wireName)});` : ""} match body { Some(bytes) => { let value = ${role === undefined ? "bytes" : `${role}(bytes)`}; ${check} Some(${field.optional ? "Some(value)" : "value"}) }, None => ${field.optional ? "Some(None)" : '{ state.reject(path, "required"); None }'} } };`;
}

/** Nonbody field decoding from the private projected document
 * @param ctx - Rendering context
 * @param field - Input member
 * @returns Field candidate binding
 */
function decodedMember(ctx: RustContext, field: Field): string {
  const decoded = decodeUse(ctx, field.type, "value", "path");
  return `let field_${snake(field.name)} = { let path = state.child(0, ${quote(field.wireName)}); ${field.optional ? `match parameters.remove(${quote(field.wireName)}) { None => Some(None), Some(value) => ${decoded}.map(Some) }` : `required(parameters.remove(${quote(field.wireName)}), path, state).and_then(|value| ${decoded})`} };`;
}

/** Borrowed member encoding with optional presence preservation
 * @param ctx - Rendering context
 * @param field - Canonical member
 * @param expression - Expression using the encoded `text`
 * @returns Member encoding statements
 */
export function encodedMember(ctx: RustContext, field: Field, expression: string): string {
  const encode = `let text = ${encodeUse(ctx, field.type, "value")}; ${expression}`;
  return field.optional
    ? `if let Some(value) = input.${snake(field.name)}() { ${encode} }`
    : `{ let value = input.${snake(field.name)}(); ${encode} }`;
}

/** Private document initialization from the selected HTTP body
 * @param plan - Resolved request projection
 * @returns Body parsing and parameter ownership statements
 */
export function initialHttpBody(plan: HttpProjectionPlan): string {
  const { http, fields, raw, bodyField, otherFields } = plan;
  return http.body.kind === "parameters"
    ? `let mut json = match body { Some(body) if !body.is_empty() => parse_json_bytes(&body)?, _ => _Json { nodes: vec![_JsonNode::Object(std::collections::BTreeMap::new())], root: 0 } }; let _JsonNode::Object(${fields.length > 0 ? "mut " : ""}parameters) = json.take(json.root) else { return Err(json_failure()); };`
    : raw === undefined && bodyField !== undefined
      ? `let mut json = match body { Some(body) if !body.is_empty() => parse_json_bytes(&body)?, _ => _Json { nodes: Vec::new(), root: 0 } }; let mut parameters = std::collections::BTreeMap::new(); if !json.nodes.is_empty() { parameters.insert(${quote(bodyField.wireName)}.into(), json.root); }`
      : `${raw === undefined || otherFields.length > 0 ? "let mut json = _Json { nodes: Vec::new(), root: 0 };" : ""} let ${fields.length > 0 || (raw !== undefined && otherFields.length > 0) ? "mut " : ""}parameters = std::collections::BTreeMap::new();`;
}

/** Input completion across the private document and raw body seam
 * @param ctx - Rendering context
 * @param plan - Resolved request projection
 * @returns Input candidate decoding statements
 */
export function decodedHttpBody(ctx: RustContext, plan: HttpProjectionPlan): string {
  const { input, raw, otherFields } = plan;
  return raw === undefined
    ? `let root = json.nodes.len(); json.nodes.push(_JsonNode::Object(parameters)); let value = _decode_${key(input)}(&mut json, root, Binding::Http, None, 0, &mut state);`
    : `let value = { let state = &mut state; ${otherFields.length > 0 ? "let json = &mut json; let binding = Binding::Http;" : ""} ${input.fields.map((field) => (field === raw ? rawMember(ctx, field) : decodedMember(ctx, field))).join("\n")} unknown(parameters, 0, state); _complete_${key(input)}(0, state${input.fields.map((field) => `, field_${snake(field.name)}`).join("")}) };`;
}

/** Owned HTTP body encoding with raw byte preservation
 * @param ctx - Rendering context
 * @param plan - Resolved request projection
 * @returns Optional body binding statements
 */
export function encodedHttpBody(ctx: RustContext, plan: HttpProjectionPlan): string {
  const { http, input, fields, bodyField, raw } = plan;
  if (http.body.kind === "parameters") {
    const placed = new Set(fields.map((field) => field.name));
    const bodyFields = input.fields.filter((field) => !placed.has(field.name));
    return `let mut body = String::from("{"); ${bodyFields.map((field) => encodedMember(ctx, field, `if body.len() > 1 { body.push(','); } body.push_str(${quote(`${JSON.stringify(field.wireName)}:`)}); body.push_str(&text);`)).join("\n")} body.push('}'); let body = Some(bytes::Bytes::from(body));`;
  }
  if (bodyField !== undefined && raw === undefined) {
    return bodyField.optional
      ? `let mut body = None; ${encodedMember(ctx, bodyField, "body = Some(bytes::Bytes::from(text));")}`
      : `let body = { let value = input.${snake(bodyField.name)}(); Some(bytes::Bytes::from(${encodeUse(ctx, bodyField.type, "value")})) };`;
  }
  if (raw !== undefined) {
    const scalar = node(ctx, raw.type.id);
    const nominal = scalar.kind === "scalar" && scalar.role !== null;
    const member = snake(raw.name);
    return `let (${input.fields.map((field) => (field === raw ? `${member},` : "_,")).join(" ")}) = input.into_parts(); let body = ${raw.optional ? `${member}.map(|value| ${nominal ? "value.into_value()" : "value"})` : `Some(${member}${nominal ? ".into_value()" : ""})`};`;
  }
  return "let body = None;";
}
