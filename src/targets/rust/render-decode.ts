import type { ContractType } from "../../model/contract-model.js";
import type { RustContext } from "./context.js";
import { key } from "./naming.js";
import { renderDecodeArms, type DecodeArms } from "./render-decode-arms.js";
import { recordVariant, tupleVariant } from "./render-enum.js";
import { traversalShape, type TraversalShape } from "./traversal-shape.js";

/** Shape-pruned decoding worklist declarations
 * @param shape - Required worklist states
 * @param generated - Type-specific task emission
 * @returns Rust selection and task declarations
 */
function declarations(shape: TraversalShape, generated: DecodeArms[]): string {
  const { types } = shape;
  const metadata: [string, string, string][] = [
    ["kind", "_Kind", "Canonical declaration selection"],
    ["node", "usize", "Flat source node"],
    ["slot", "usize", "Typed result destination"],
    ["path", "_Path", "Validation path index"],
  ];
  if (shape.nullable) metadata.push(["nullable", "bool", "Null acceptance at this use"]);
  if (shape.leaves) metadata.push(["encoding", "Option<&'a str>", "Scalar wire encoding override"]);
  return `/// Canonical declaration selected for a private decode task
#[derive(Clone, Copy)]
enum _Kind { ${types.map((type) => `/// Selection of ${type.name}\n${type.name},`).join("\n")} }
/// Completed immediate typed values with separate absence and null states
enum _Decoded {
  /// Failed or pending typed result
  Failed,
  ${shape.missing ? "/// Omitted optional object member\nMissing," : ""}
  ${shape.nullable ? "/// Accepted explicit null\nNull," : ""}
  ${types.map((type) => tupleVariant(`Value${type.name}`, `Completed ${type.name} candidate`, [[type.name, "Owned canonical candidate"]])).join("\n")}
}
/// Pending typed construction without recursive stack frames
enum _Decode${shape.leaves ? "<'a>" : ""} {
  ${recordVariant("Visit", "Decoding of one source node", metadata)}
  ${generated.map((item) => item.variants).join("\n")}
}
`;
}

/** Flat-input decoding loop with post-order typed construction
 * @param shape - Required worklist states
 * @param generated - Type-specific task emission
 * @returns Rust graph decoding function
 */
function traversal(shape: TraversalShape, generated: DecodeArms[]): string {
  const presence = shape.nullable ? ", nullable" : "";
  const encoding = shape.leaves ? ", encoding" : "";
  return `/// Flat-input typed construction through an explicit worklist
///
/// - json: consumed flat parser storage
/// - node: root source node
/// - kind: canonical declaration selection
/// - binding: boundary encoding interpretation
/// - encoding: root encoding override
/// - path: root path index
/// - state: validation accumulator
/// - Return: completed canonical root or a failed candidate
fn __decode_graph(json: &mut _Json, node: usize, kind: _Kind, ${shape.leaves ? "binding" : "_binding"}: Binding, ${shape.leaves ? "encoding" : "_encoding"}: Option<&str>, path: _Path, state: &mut State) -> _Decoded {
  let mut values = vec![_Decoded::Failed];
  let mut pending = vec![_Decode::Visit { kind, node, slot: 0, path${shape.nullable ? ", nullable: false" : ""}${encoding} }];
  while let Some(task) = pending.pop() { match task {
    _Decode::Visit { kind, node, slot, path${presence}${encoding} } => {
      ${shape.nullable ? "if nullable && matches!(json.nodes[node], _JsonNode::Null) { values[slot] = _Decoded::Null; continue; }" : ""}
      match kind { ${generated.map((item) => item.enter).join("\n")} }
    }
    ${generated.map((item) => item.finish).join("\n")}
  } }
  std::mem::replace(&mut values[0], _Decoded::Failed)
}
`;
}

/** Composite codec entry point through the shared worklist
 * @param type - Canonical composite declaration
 * @returns Rust private decoding entry point
 */
function entrypoint(type: ContractType): string {
  return `/// Private stack-safe decoding of ${type.name}
///
/// - json: flat parser storage
/// - node: source node
/// - binding: wire interpretation
/// - encoding: root encoding override
/// - path: root path index
/// - state: validation accumulator
/// - Return: canonical candidate
fn _decode_${key(type)}(json: &mut _Json, node: usize, binding: Binding, encoding: Option<&str>, path: _Path, state: &mut State) -> Option<${type.name}> {
  match __decode_graph(json, node, _Kind::${type.name}, binding, encoding, path, state) { _Decoded::Value${type.name}(value) => Some(value), _ => None }
}
`;
}

/** Iterative typed decoding without recursive child codec calls
 * @param ctx - Complete rendering context
 * @returns Private worklist and per-composite codec entry points
 */
export function renderDecode(ctx: RustContext): string {
  const shape = traversalShape(ctx);
  const composites = shape.types.filter(
    (type) => type.kind === "object" || type.kind === "array" || type.kind === "union",
  );
  if (composites.length === 0) return "";
  const generated = shape.types.map((type, index) => renderDecodeArms(ctx, shape, type, index));
  return (
    declarations(shape, generated) +
    traversal(shape, generated) +
    composites.map(entrypoint).join("\n")
  );
}
