import type { ContractType, TypeUse } from "../../model/contract-model.js";
import { encodingOverride } from "./codec-use.js";
import { node, type RustContext } from "./context.js";
import { key, quote, snake } from "./naming.js";
import { tupleVariant } from "./render-enum.js";
import { traversalShape, type TraversalShape } from "./traversal-shape.js";

/** Scheduling of a borrowed canonical value without graph cloning
 * @param ctx - Rendering context
 * @param use - Canonical use
 * @param expression - Borrowed value expression
 * @returns Rust worklist push statements
 */
function schedule(ctx: RustContext, use: TypeUse, expression: string): string {
  const type = node(ctx, use.id);
  const leaf = type.kind === "scalar" || type.kind === "enum" || type.kind === "literal";
  const push = `pending.push(_Write::Value${type.name}(${use.nullable ? "value" : expression}${leaf ? `, ${encodingOverride(use)}` : ""}));`;
  return use.nullable
    ? `match ${expression} { Some(value) => { ${push} } None => pending.push(_Write::Null) }`
    : push;
}

/** Borrowed encoder dispatch for one canonical declaration
 * @param ctx - Rendering context
 * @param type - Canonical declaration
 * @returns Rust worklist match arm
 */
function arm(ctx: RustContext, type: ContractType): string {
  const name = type.name;
  if (type.kind === "object")
    return `_Write::Value${name}(${type.fields.length ? "value" : "_value"}) => {
    writer.begin_object(); pending.push(_Write::EndObject);
    ${[...type.fields]
      .reverse()
      .map((field) => {
        const body = `${schedule(ctx, field.type, "member")} pending.push(_Write::Key(${quote(field.wireName)}));`;
        return field.optional
          ? `if let Some(member) = value.${snake(field.name)}() { ${body} }`
          : `{ let member = value.${snake(field.name)}(); ${body} }`;
      })
      .join("\n")}
  },`;
  if (type.kind === "array")
    return `_Write::Value${name}(value) => {
    writer.begin_array(); pending.push(_Write::EndArray);
    for member in value.as_slice().iter().rev() { ${schedule(ctx, type.element, "member")} }
  },`;
  if (type.kind === "union")
    return `_Write::Value${name}(value) => match value.as_case() { ${type.variants.map((variant) => `${name}Case::${variant.name}(value) => { ${schedule(ctx, variant.type, "value")} },`).join("\n")} },`;
  return `_Write::Value${name}(value, encoding) => _write_${key(type)}(value, binding, encoding, &mut writer),`;
}

/** Shape-pruned structural writer events
 * @param shape - Required traversal states
 * @returns Event declarations and dispatch arms
 */
function structuralEvents(shape: TraversalShape): { variants: string; arms: string } {
  const { types } = shape;
  const objects = types.some((type) => type.kind === "object");
  const keys = types.some((type) => type.kind === "object" && type.fields.length > 0);
  const arrays = types.some((type) => type.kind === "array");
  return {
    variants: `
  ${shape.nullable ? "/// Explicit nullable member\nNull," : ""}
  ${keys ? tupleVariant("Key", "Object member name", [["&'static str", "Contract wire name"]]) : ""}
  ${objects ? "/// Closing object event\nEndObject," : ""}
  ${arrays ? "/// Closing array event\nEndArray," : ""}
`,
    arms: `
    ${shape.nullable ? "_Write::Null => writer.null()," : ""}
    ${keys ? "_Write::Key(key) => writer.key(key)," : ""}
    ${objects ? "_Write::EndObject => writer.end_object()," : ""}
    ${arrays ? "_Write::EndArray => writer.end_array()," : ""}
`,
  };
}

/** Borrowed canonical task declaration
 * @param type - Canonical declaration
 * @returns Value task variant with leaf encoding state
 */
function valueVariant(type: ContractType): string {
  const fields: [string, string][] = [[`&'a ${type.name}`, "Borrowed canonical value"]];
  if (type.kind === "scalar" || type.kind === "enum" || type.kind === "literal")
    fields.push(["Option<&'a str>", "Scalar wire encoding override"]);
  return tupleVariant(`Value${type.name}`, `Borrowed ${type.name} encoding`, fields);
}

/** Borrowed encoding loop over canonical tasks
 * @param ctx - Rendering context
 * @param shape - Required traversal states
 * @param events - Structural event dispatch arms
 * @returns Rust graph encoding function
 */
function traversal(ctx: RustContext, shape: TraversalShape, events: string): string {
  return `/// Borrowed stack-safe JSON event emission
///
/// - root: canonical root task
/// - binding: wire interpretation
/// - Return: complete JSON text
fn __encode_graph(root: _Write<'_>, ${shape.leaves ? "binding" : "_binding"}: Binding) -> String {
  let mut writer = _JsonWriter::new();
  let mut pending = vec![root];
  while let Some(task) = pending.pop() { match task {
    ${events}
    ${shape.types.map((type) => arm(ctx, type)).join("\n")}
  } }
  writer.finish()
}
`;
}

/** Composite writer entry point through the borrowed worklist
 * @param type - Canonical composite declaration
 * @returns Rust private encoding entry point
 */
function entrypoint(type: ContractType): string {
  return `/// Borrowed stack-safe JSON encoding of ${type.name}
///
/// - value: canonical immutable value
/// - binding: wire interpretation
/// - encoding: irrelevant composite encoding override
/// - Return: complete JSON text
fn _encode_${key(type)}(value: &${type.name}, binding: Binding, _encoding: Option<&str>) -> String {
  __encode_graph(_Write::Value${type.name}(value), binding)
}
`;
}

/** Iterative streaming encoding of borrowed canonical values
 * @param ctx - Complete rendering context
 * @returns Private worklist and per-composite JSON text writers
 */
export function renderEncode(ctx: RustContext): string {
  const shape = traversalShape(ctx);
  const composites = shape.types.filter(
    (type) => type.kind === "object" || type.kind === "array" || type.kind === "union",
  );
  if (composites.length === 0) return "";
  const events = structuralEvents(shape);
  return `/// Borrowed canonical event work without a JSON tree
enum _Write<'a> {
  ${events.variants}
  ${shape.types.map(valueVariant).join("\n")}
}
${traversal(ctx, shape, events.arms)}${composites.map(entrypoint).join("\n")}`;
}
