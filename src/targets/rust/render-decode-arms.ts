import type { ContractType, Field, TypeUse } from "../../model/contract-model.js";
import { completeUse, needsBaseCheck, optional } from "./checks.js";
import { encodingOverride } from "./codec-use.js";
import { node, type RustContext } from "./context.js";
import { key, quote, snake } from "./naming.js";
import { recordVariant } from "./render-enum.js";
import type { TraversalShape } from "./traversal-shape.js";

/** Type-specific decoding task emission */
export interface DecodeArms {
  /** Source node dispatch arm */
  enter: string;
  /** Post-order task declarations */
  variants: string;
  /** Completed child reconstruction arms */
  finish: string;
}

/** Extraction of a completed typed slot with independent omission and null states
 * @param ctx - Rendering context
 * @param use - Canonical child use
 * @param slot - Result slot expression
 * @param optional - Omission allowance
 * @returns Rust Option expression of the immediate member storage
 */
function decoded(ctx: RustContext, use: TypeUse, slot: string, optional = false): string {
  const some = use.nullable ? "Some(value)" : "value";
  return `match std::mem::replace(&mut values[${slot}], _Decoded::Failed) {
    _Decoded::Value${node(ctx, use.id).name}(value) => Some(${optional ? `Some(${some})` : some}),
    ${use.nullable ? `_Decoded::Null => Some(${optional ? "Some(None)" : "None"}),` : ""}
    ${optional ? "_Decoded::Missing => Some(None)," : ""}
    _ => None,
  }`;
}

/** Scheduled decoding of a present immediate member
 * @param ctx - Rendering context
 * @param shape - Required worklist states
 * @param use - Canonical child use
 * @param slot - Destination slot expression
 * @param source - Source node expression
 * @param path - Child path expression
 * @returns Rust worklist push statement
 */
function visit(
  ctx: RustContext,
  shape: TraversalShape,
  use: TypeUse,
  slot: string,
  source: string,
  path: string,
): string {
  return `pending.push(_Decode::Visit { kind: _Kind::${node(ctx, use.id).name}, ${source === "node" ? "node" : `node: ${source}`}, ${slot === "slot" ? "slot" : `slot: ${slot}`}, ${path === "path" ? "path" : `path: ${path}`}${shape.nullable ? `, nullable: ${use.nullable}` : ""}${shape.leaves ? `, encoding: ${encodingOverride(use)}` : ""} });`;
}

/** Object member scheduling with omission enforcement
 * @param ctx - Rendering context
 * @param shape - Required worklist states
 * @param field - Canonical member
 * @param index - Immediate result offset
 * @returns Rust member scheduling block
 */
function member(ctx: RustContext, shape: TraversalShape, field: Field, index: number): string {
  const slot = index === 0 ? "base" : `base + ${index}`;
  return `{ let child_path = state.child(path, ${quote(field.wireName)});
    match object.remove(${quote(field.wireName)}) {
      Some(child) => { ${visit(ctx, shape, field.type, slot, "child", "child_path")} }
      None => { ${field.optional ? `values[${slot}] = _Decoded::Missing;` : 'state.reject(child_path, "required");'} }
    }
  }`;
}

/** Object decoding with independent member result slots
 * @param ctx - Rendering context
 * @param shape - Required worklist states
 * @param type - Canonical object declaration
 * @param ordinal - Deterministic task name index
 * @returns Object visit and completion emission
 */
function objectArms(
  ctx: RustContext,
  shape: TraversalShape,
  type: Extract<ContractType, { kind: "object" }>,
  ordinal: number,
): DecodeArms {
  const name = type.name;
  const fields = type.fields
    .map(
      (field, index) =>
        `let field_${snake(field.name)} = ${decoded(ctx, field.type, index === 0 ? "base" : `base + ${index}`, field.optional)};`,
    )
    .join("\n");
  const metadata: [string, string, string][] = [["slot", "usize", "Completed object destination"]];
  if (type.fields.length) metadata.push(["base", "usize", "Immediate member result offset"]);
  metadata.push(["path", "_Path", "Object validation path"]);
  const base = type.fields.length ? ", base" : "";
  return {
    variants: recordVariant(
      `Object${ordinal}`,
      `Completion of ${name} immediate members`,
      metadata,
    ),
    enter: `_Kind::${name} => {
        let object = json.take(node);
        let _JsonNode::Object(${type.fields.length ? "mut " : ""}object) = object else { state.reject(path, if matches!(object, _JsonNode::Null) { "null" } else { "type" }); continue; };
        ${type.fields.length ? `let base = values.len(); values.resize_with(base + ${type.fields.length}, || _Decoded::Failed);` : ""}
        pending.push(_Decode::Object${ordinal} { slot${base}, path });
        ${type.fields
          .map((field, index) => member(ctx, shape, field, index))
          .reverse()
          .join("\n")}
        for (key, _) in object { state.observe(path, key); }
      },`,
    finish: `_Decode::Object${ordinal} { slot${base}, path } => {
        ${fields}
        if let Some(value) = _complete_${key(type)}(path, state${type.fields.map((field) => `, field_${snake(field.name)}`).join("")}) { values[slot] = _Decoded::Value${name}(value); }
      },`,
  };
}

/** Array decoding with per-element completion checks
 * @param ctx - Rendering context
 * @param shape - Required worklist states
 * @param type - Canonical array declaration
 * @param ordinal - Deterministic task name index
 * @returns Array visit and completion emission
 */
function arrayArms(
  ctx: RustContext,
  shape: TraversalShape,
  type: Extract<ContractType, { kind: "array" }>,
  ordinal: number,
): DecodeArms {
  const name = type.name;
  const check = completeUse(ctx, type.element, "&value", "member_path");
  const metadata: [string, string, string][] = [
    ["slot", "usize", "Completed array destination"],
    ["base", "usize", "Immediate element result offset"],
    ["length", "usize", "Source element count"],
  ];
  if (check) metadata.push(["path", "_Path", "Element validation parent"]);
  return {
    variants: recordVariant(
      `Array${ordinal}`,
      `Completion of ${name} immediate elements`,
      metadata,
    ),
    enter: `_Kind::${name} => {
        let source = json.take(node);
        let _JsonNode::Array(source) = source else { state.reject(path, if matches!(source, _JsonNode::Null) { "null" } else { "type" }); continue; };
        let length = source.len(); let base = values.len(); values.resize_with(base + length, || _Decoded::Failed);
        ${type.constraints.minItems === undefined && type.constraints.maxItems === undefined ? "" : `check_items(length, ${optional(type.constraints.minItems)}, ${optional(type.constraints.maxItems)}, path, state);`}
        pending.push(_Decode::Array${ordinal} { slot, base, length${check ? ", path" : ""} });
        for (index, child) in source.into_iter().enumerate().rev() { let child_path = state.child(path, index.to_string()); ${visit(ctx, shape, type.element, "base + index", "child", "child_path")} }
      },`,
    finish: `_Decode::Array${ordinal} { slot, base, length${check ? ", path" : ""} } => {
        let mut result = Vec::with_capacity(length);
        for index in 0..length { if let Some(value) = ${decoded(ctx, type.element, "base + index")} { ${check ? `let member_path = state.child(path, index.to_string()); ${check}` : ""} result.push(value); } }
        values[slot] = _Decoded::Value${name}(${name}(Some(std::sync::Arc::new(result))));
      },`,
  };
}

/** Discriminated union decoding through the selected child task
 * @param ctx - Rendering context
 * @param shape - Required worklist states
 * @param type - Canonical union declaration
 * @param ordinal - Deterministic task name index
 * @returns Union visit and completion emission
 */
function unionArms(
  ctx: RustContext,
  shape: TraversalShape,
  type: Extract<ContractType, { kind: "union" }>,
  ordinal: number,
): DecodeArms {
  const name = type.name;
  return {
    variants: type.variants
      .map((variant, index) =>
        recordVariant(`Union${ordinal}Case${index}`, `Completion of ${name} case ${variant.name}`, [
          ["slot", "usize", "Completed union destination"],
          ["child", "usize", "Decoded payload result"],
          ["path", "_Path", "Discriminator validation parent"],
        ]),
      )
      .join("\n"),
    enter: `_Kind::${name} => {
      let _JsonNode::Object(object) = &json.nodes[node] else { state.reject(path, if matches!(json.nodes[node], _JsonNode::Null) { "null" } else { "type" }); continue; };
      let selected = object.get(${quote(type.discriminator)}).and_then(|index| match &json.nodes[*index] { _JsonNode::String(tag) => Some(tag.as_str()), _ => None });
      let child = values.len(); values.push(_Decoded::Failed);
      match selected {
        ${type.variants.map((variant, index) => `Some(${quote(variant.tag)}) => { pending.push(_Decode::Union${ordinal}Case${index} { slot, child, path }); ${visit(ctx, shape, variant.type, "child", "node", "path")} },`).join("\n")}
        _ => { let path = state.child(path, ${quote(type.discriminator)}); state.reject(path, "variant"); }
      }
    },`,
    finish: type.variants
      .map(
        (variant, index) => `_Decode::Union${ordinal}Case${index} { slot, child, path } => {
      if let Some(value) = ${decoded(ctx, variant.type, "child")}
        && let Some(value) = _complete_${key(type)}(path, state, ${name}Case::${variant.name}(value)) { values[slot] = _Decoded::Value${name}(value); }
    },`,
      )
      .join("\n"),
  };
}

/** Worklist entry and completion arms for one canonical declaration
 * @param ctx - Rendering context
 * @param shape - Required worklist states
 * @param type - Canonical declaration
 * @param ordinal - Deterministic declaration index for private task names
 * @returns Visit arm and completion declarations
 */
export function renderDecodeArms(
  ctx: RustContext,
  shape: TraversalShape,
  type: ContractType,
  ordinal: number,
): DecodeArms {
  if (type.kind === "object") return objectArms(ctx, shape, type, ordinal);
  if (type.kind === "array") return arrayArms(ctx, shape, type, ordinal);
  if (type.kind === "union") return unionArms(ctx, shape, type, ordinal);
  return {
    variants: "",
    finish: "",
    enter: `_Kind::${type.name} => { if let Some(value) = ${needsBaseCheck(type) ? "_parse" : "_decode"}_${key(type)}(json, node, binding, encoding, path, state) { values[slot] = _Decoded::Value${type.name}(value); } },`,
  };
}
