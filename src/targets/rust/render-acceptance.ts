import type { ContractType, ObjectType, Operation } from "../../model/contract-model.js";
import { defaulted } from "./accepting.js";
import { node, type RustContext } from "./context.js";
import { key, snake, stem } from "./naming.js";
import { objectValue, renderObjectStorage } from "./render-storage.js";
import { tupleVariant } from "./render-enum.js";
import { renderAcceptanceArms } from "./render-acceptance-arms.js";

/** Required-presence provider input after omission-only defaults
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Accepted provider input type
 */
export function acceptedType(ctx: RustContext, operation: Operation): string {
  const input = node(ctx, operation.input);
  return input.kind === "object" && input.fields.some(defaulted)
    ? `${stem(operation)}Accepted`
    : input.name;
}

/** Provider-effective root input with canonical child handles
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @param input - Input object declaration
 * @returns Stronger root storage and public acceptance function
 */
function operationAcceptance(ctx: RustContext, operation: Operation, input: ObjectType): string {
  const target = acceptedType(ctx, operation);
  const call = ctx.accepting.has(input.id) ? `_accept_${key(input)}(value)` : "value";
  const stronger = target !== input.name;
  const body = stronger
    ? `let value = ${call}; let (${input.fields.map((field) => `field_${snake(field.name)},`).join(" ")}) = value.into_parts();
    ${objectValue(
      input,
      input.fields.map(
        (field) =>
          `${snake(field.name)}: ${defaulted(field) ? `match field_${snake(field.name)} { Some(value) => value, None => panic!("broken provider completion invariant") }` : `field_${snake(field.name)}`}`,
      ),
      target,
    )}`
    : call;
  return `${stronger ? renderObjectStorage(ctx, input, target, true) : ""}
/// Provider-only omission default application without child revalidation
///
/// - value: accepted pre-default operation input
/// - Return: effective handler input with nested defaults
${stronger ? "/// # Panics\n/// Broken internal provider completion invariant\n" : ""}pub fn accept_${snake(operation.name)}(value: ${input.name}) -> ${target} { ${body} }
`;
}

/** Borrowed acceptance task pair for a changeable declaration
 * @param ctx - Generation context
 * @param type - Input-reachable declaration
 * @returns Visit and post-order completion task declarations
 */
function taskVariants(ctx: RustContext, type: ContractType): string {
  const fields: [string, string][] = [
    [`&'a ${type.name}`, "Borrowed original canonical value"],
    ["usize", "Changed-result destination"],
  ];
  const visit = tupleVariant(`Visit${type.name}`, `Provider traversal of ${type.name}`, fields);
  if (type.kind !== "object" || type.fields.some((field) => ctx.accepting.has(field.type.id)))
    fields.push(["usize", "Immediate child result offset"]);
  return (
    visit + "\n" + tupleVariant(`Done${type.name}`, `Post-order completion of ${type.name}`, fields)
  );
}

/** Acceptance state declarations restricted to changeable subtrees
 * @param ctx - Generation context
 * @param types - Input-reachable declarations with defaults
 * @returns Rust replacement and task declarations
 */
function declarations(ctx: RustContext, types: ContractType[]): string {
  return `/// Changed canonical subtrees produced by provider defaults
#[derive(Clone)]
enum _Accepted { ${types.map((type) => tupleVariant(type.name, `Changed ${type.name} subtree`, [[type.name, "Owned replacement canonical value"]])).join("\n")} }
/// Borrowed provider traversal with post-order reconstruction
enum _Accept<'a> { ${types.map((type) => taskVariants(ctx, type)).join("\n")} }
`;
}

/** Provider traversal with shared subtree completion memoization
 * @param ctx - Generation context
 * @param types - Input-reachable declarations with defaults
 * @returns Rust iterative default transformation function
 */
function traversal(ctx: RustContext, types: ContractType[]): string {
  const memoized = types.some(
    (type) => type.kind === "array" || (type.kind === "object" && ctx.shared.has(type.id)),
  );
  const grows = types.some(
    (type) =>
      type.kind !== "object" || type.fields.some((field) => ctx.accepting.has(field.type.id)),
  );
  return `/// Provider default transformation without recursive calls
///
/// - root: borrowed root with destination zero
/// - Return: changed canonical root or unchanged identity
fn __accept_graph(root: _Accept<'_>) -> Option<_Accepted> {
  let mut values = ${grows ? "vec![None]" : "[None]"};
  let mut pending = vec![root];
  ${memoized ? "let mut memo: std::collections::HashMap<(usize, usize), Option<_Accepted>> = std::collections::HashMap::new();" : ""}
  while let Some(task) = pending.pop() { match task { ${types.map((type, index) => renderAcceptanceArms(ctx, type, index)).join("\n")} } }
  values[0].take()
}
`;
}

/** Root acceptance entry point preserving unchanged identity
 * @param type - Canonical operation input declaration
 * @param multiple - Presence of other accepted result kinds
 * @returns Rust private provider acceptance entry point
 */
function entrypoint(type: ContractType, multiple: boolean): string {
  return `/// Provider default application preserving unchanged canonical identity
///
/// - value: accepted pre-default value
/// - Return: transformed or unchanged canonical value
fn _accept_${key(type)}(value: ${type.name}) -> ${type.name} {
  match __accept_graph(_Accept::Visit${type.name}(&value, 0)) { Some(_Accepted::${type.name}(result)) => result, None => value, ${multiple ? '_ => unreachable!("matching provider acceptance root")' : ""} }
}
`;
}

/** Iterative provider defaults with copying confined to changed ancestors
 * @param ctx - Generation context
 * @returns Acceptance worklist and effective input declarations
 */
export function renderAcceptance(ctx: RustContext): string {
  const types = ctx.model.types.filter(
    (type) =>
      ctx.accepting.has(type.id) &&
      (type.kind === "object" || type.kind === "array" || type.kind === "union"),
  );
  const graph = types.length === 0 ? "" : declarations(ctx, types) + traversal(ctx, types);
  const roots = types
    .filter((type) => ctx.model.operations.some((operation) => operation.input === type.id))
    .map((type) => entrypoint(type, types.length > 1))
    .join("\n");
  return (
    graph +
    roots +
    ctx.model.operations
      .map((operation) => {
        const input = node(ctx, operation.input);
        return input.kind === "object" ? operationAcceptance(ctx, operation, input) : "";
      })
      .join("\n")
  );
}
