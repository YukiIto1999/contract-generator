import type { ArrayType, ObjectType, TypeUse } from "../../model/contract-model.js";
import { node, type RustContext } from "./context.js";
import { snake } from "./naming.js";
import { tupleVariant } from "./render-enum.js";
import { useType } from "./storage.js";

/** Transfer of a composite child's last-owner obligation to the local worklist
 * @param ctx - Rendering context
 * @param use - Canonical child use
 * @param expression - Owned immediate child
 * @param optional - Outer field-presence wrapper
 * @returns Rust ownership transfer statements
 */
function retire(ctx: RustContext, use: TypeUse, expression: string, optional = false): string {
  const type = node(ctx, use.id);
  let body = "";
  if (type.kind === "array" || (type.kind === "object" && ctx.shared.has(type.id)))
    body = `let mut value = value; if let Some(data) = value.0.take() { pending.push(_Drop::${type.name}(data)); }`;
  else if (type.kind === "union") {
    const cases = type.variants.map((variant) => {
      const release = retire(ctx, variant.type, "payload");
      return `${type.name}Case::${variant.name}(${release === "" ? "_" : "payload"}) => { ${release} },`;
    });
    body = `match value.into_case() { ${cases.join("\n")} }`;
  }
  if (body === "") return "";
  const wrappers = Number(optional) + Number(use.nullable);
  return wrappers > 0
    ? `if let ${"Some(".repeat(wrappers)}value${")".repeat(wrappers)} = ${expression} { ${body} }`
    : expression === "value"
      ? body
      : `{ let value = ${expression}; ${body} }`;
}

/** Last-owner child reclamation for one shared payload
 * @param ctx - Rendering context
 * @param type - Shared payload declaration
 * @returns Rust release worklist arm
 */
function releaseArm(ctx: RustContext, type: ArrayType | ObjectType): string {
  const element = type.kind === "array" ? retire(ctx, type.element, "value") : "";
  const body =
    type.kind === "array"
      ? element
        ? `for value in data { ${element} }`
        : ""
      : type.fields
          .map((field) => retire(ctx, field.type, `data.${snake(field.name)}`, field.optional))
          .filter(Boolean)
          .join("\n");
  return `_Drop::${type.name}(data) => { let Some(${body ? "data" : "_data"}) = std::sync::Arc::into_inner(data) else { continue; }; ${body} },`;
}

/** Iterative reclamation of released shared canonical payloads
 * @param ctx - Rendering context
 * @param shared - Declarations with shared payload ownership
 * @returns Private release worklist declarations
 */
export function renderRelease(ctx: RustContext, shared: (ArrayType | ObjectType)[]): string {
  if (shared.length === 0) return "";
  return `/// Pending last-owner payloads without recursive canonical destructors
enum _Drop { ${shared.map((type) => tupleVariant(type.name, `Released ${type.name} payload ownership`, [[`std::sync::Arc<${type.kind === "array" ? `Vec<${useType(ctx, type.element)}>` : `_${type.name}Data`}>`, "Released strong payload reference"]])).join("\n")} }
/// Iterative reclamation of private shared payloads
///
/// - root: released canonical ownership
fn _drop_graph(root: _Drop) {
  let mut pending = vec![root];
  while let Some(value) = pending.pop() { match value {
    ${shared.map((type) => releaseArm(ctx, type)).join("\n")}
  } }
}
`;
}
