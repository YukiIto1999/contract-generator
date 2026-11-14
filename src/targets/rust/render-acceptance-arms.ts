import type { ContractType, Field, ObjectType, TypeUse } from "../../model/contract-model.js";
import { defaulted } from "./accepting.js";
import { node, type RustContext } from "./context.js";
import { defaultValue } from "./defaults.js";
import { snake } from "./naming.js";

/** Scheduling of a borrowed child whose subtree may change
 * @param ctx - Rendering context
 * @param use - Canonical child use
 * @param expression - Borrowed child presence expression
 * @param slot - Changed-result slot
 * @param optional - Independent omission wrapper
 * @returns Rust worklist push or an empty statement
 */
function schedule(
  ctx: RustContext,
  use: TypeUse,
  expression: string,
  slot: string,
  optional = false,
): string {
  if (!ctx.accepting.has(use.id)) return "";
  const wrappers = Number(optional) + Number(use.nullable);
  const push = `pending.push(_Accept::Visit${node(ctx, use.id).name}(value, ${slot}));`;
  return wrappers === 0
    ? expression === "value"
      ? push
      : `{ let value = ${expression}; ${push} }`
    : `if let ${"Some(".repeat(wrappers)}value${")".repeat(wrappers)} = ${expression} { ${push} }`;
}

/** Reconstruction wrapper for a changed non-null child
 * @param use - Canonical child use
 * @param optional - Independent omission wrapper
 * @returns Rust member replacement expression
 */
function wrap(use: TypeUse, optional = false): string {
  const count = Number(use.nullable) + Number(optional);
  return `${"Some(".repeat(count)}replacement${")".repeat(count)}`;
}

/** Object acceptance scheduling limited to changeable children
 * @param ctx - Rendering context
 * @param type - Canonical object declaration
 * @param children - Members with reachable defaults
 * @param reuse - Shared identity lookup statement
 * @returns Rust object visit arm
 */
function objectVisit(ctx: RustContext, type: ObjectType, children: Field[], reuse: string): string {
  return `_Accept::Visit${type.name}(value, slot) => {
      ${reuse}
      ${children.length ? `let base = values.len(); values.resize_with(base + ${children.length}, || None);` : ""}
      pending.push(_Accept::Done${type.name}(value, slot${children.length ? ", base" : ""}));
      ${children
        .map((field, index) =>
          schedule(
            ctx,
            field.type,
            `value.${snake(field.name)}()`,
            index === 0 ? "base" : `base + ${index}`,
            field.optional,
          ),
        )
        .reverse()
        .join("\n")}
    },`;
}

/** Changed-ancestor object reconstruction with omission-only defaults
 * @param ctx - Rendering context
 * @param type - Canonical object declaration
 * @param children - Members with reachable defaults
 * @param remember - Shared identity completion statement
 * @returns Rust object completion arm
 */
function objectFinish(
  ctx: RustContext,
  type: ObjectType,
  children: Field[],
  remember: string,
): string {
  const name = type.name;
  const changes = children.map(
    (_, index) => `values[${index === 0 ? "base" : `base + ${index}`}].is_some()`,
  );
  changes.push(
    ...type.fields.filter(defaulted).map((field) => `value.${snake(field.name)}().is_none()`),
  );
  const updates = children
    .map(
      (field, index) =>
        `if let Some(_Accepted::${node(ctx, field.type.id).name}(replacement)) = values[${index === 0 ? "base" : `base + ${index}`}].take() { data.${snake(field.name)} = ${wrap(field.type, field.optional)}; }`,
    )
    .join("\n");
  const defaults = type.fields
    .filter(defaulted)
    .map(
      (field) =>
        `if data.${snake(field.name)}.is_none() { data.${snake(field.name)} = Some(${defaultValue(ctx, field)}); }`,
    )
    .join("\n");
  return `_Accept::Done${name}(value, slot${children.length ? ", base" : ""}) => {
      if ${changes.length ? changes.join(" || ") : "false"} {
        let mut data = __data_${snake(name)}(value).clone();
        ${updates}
        ${defaults}
        values[slot] = Some(_Accepted::${name}(__from_data_${snake(name)}(data)));
      }
      ${remember}
    },`;
}

/** Array acceptance with reconstruction confined to changed elements
 * @param ctx - Rendering context
 * @param type - Canonical array declaration
 * @param reuse - Shared identity lookup statement
 * @param remember - Shared identity completion statement
 * @returns Rust array visit and completion arms
 */
function arrayArms(
  ctx: RustContext,
  type: Extract<ContractType, { kind: "array" }>,
  reuse: string,
  remember: string,
): string {
  const name = type.name;
  return `_Accept::Visit${name}(value, slot) => {
    ${reuse}
    let base = values.len(); values.resize_with(base + value.as_slice().len(), || None);
    pending.push(_Accept::Done${name}(value, slot, base));
    for (index, value) in value.as_slice().iter().enumerate().rev() { ${schedule(ctx, type.element, "value", "base + index")} }
  },
  _Accept::Done${name}(value, slot, base) => {
    let length = value.as_slice().len();
    if values[base..base + length].iter().any(Option::is_some) {
      let mut result = value.as_slice().to_vec();
      for (index, member) in result.iter_mut().enumerate() {
        if let Some(_Accepted::${node(ctx, type.element.id).name}(replacement)) = values[base + index].take() { *member = ${wrap(type.element)}; }
      }
      values[slot] = Some(_Accepted::${name}(${name}(Some(std::sync::Arc::new(result)))));
    }
    ${remember}
  },`;
}

/** Union acceptance through the selected changeable payload
 * @param ctx - Rendering context
 * @param type - Canonical union declaration
 * @returns Rust union visit and completion arms
 */
function unionArms(ctx: RustContext, type: Extract<ContractType, { kind: "union" }>): string {
  const name = type.name;
  return `_Accept::Visit${name}(value, slot) => {
    let base = values.len(); values.push(None);
    pending.push(_Accept::Done${name}(value, slot, base));
    match value.as_case() { ${type.variants.map((variant) => `${name}Case::${variant.name}(${ctx.accepting.has(variant.type.id) ? "value" : "_value"}) => { ${schedule(ctx, variant.type, "value", "base")} },`).join("\n")} }
  },
  _Accept::Done${name}(value, slot, base) => {
    if let Some(replacement) = values[base].take() {
      match (value.as_case(), replacement) {
        ${type.variants
          .filter((variant) => ctx.accepting.has(variant.type.id))
          .map(
            (variant) =>
              `(${name}Case::${variant.name}(_), _Accepted::${node(ctx, variant.type.id).name}(replacement)) => { values[slot] = Some(_Accepted::${name}(${name}(${name}Case::${variant.name}(${wrap(variant.type)})))); },`,
          )
          .join("\n")}
        _ => unreachable!("matching provider acceptance task"),
      }
    }
  },`;
}

/** Provider acceptance worklist arms for one input-reachable declaration
 * @param ctx - Rendering context
 * @param type - Input-reachable declaration
 * @param ordinal - Per-call identity tag for the canonical declaration
 * @returns Rust visit and completion arms
 */
export function renderAcceptanceArms(
  ctx: RustContext,
  type: ContractType,
  ordinal: number,
): string {
  const shared = type.kind === "array" || (type.kind === "object" && ctx.shared.has(type.id));
  const identity = `(${ordinal}_usize, std::sync::Arc::as_ptr(match value.0.as_ref() { Some(data) => data, None => panic!("broken canonical ownership invariant") }) as usize)`;
  const reuse = shared
    ? `if let Some(completed) = memo.get(&${identity}) { values[slot] = completed.clone(); continue; }`
    : "";
  const remember = shared ? `memo.insert(${identity}, values[slot].clone());` : "";
  if (type.kind === "object") {
    const children = type.fields.filter((field) => ctx.accepting.has(field.type.id));
    return (
      objectVisit(ctx, type, children, reuse) + "\n" + objectFinish(ctx, type, children, remember)
    );
  }
  if (type.kind === "array") return arrayArms(ctx, type, reuse, remember);
  if (type.kind === "union") return unionArms(ctx, type);
  return "";
}
