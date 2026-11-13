import type { ArrayType, ObjectType, TypeUse, UnionType } from "../../model/contract-model.js";
import { defaulted } from "./accepting.js";
import { node, type RustContext } from "./context.js";
import { quote, snake, stem } from "./naming.js";
import { renderRelease } from "./render-release.js";
import { tupleVariant } from "./render-enum.js";
import { traversalShape } from "./traversal-shape.js";

/** Canonical declarations containing traversable members */
type Composite = ObjectType | ArrayType | UnionType;

/** Canonical and provider-effective declarations requiring iterative traits
 * @param ctx - Rendering context
 * @returns Composite declarations with effective field presence
 */
function declarations(ctx: RustContext): Composite[] {
  const result = ctx.model.types.filter(
    (type): type is Composite =>
      type.kind === "object" || type.kind === "array" || type.kind === "union",
  );
  for (const operation of ctx.model.operations) {
    const input = node(ctx, operation.input);
    if (input.kind === "object" && input.fields.some(defaulted))
      result.push({
        ...input,
        name: `${stem(operation)}Accepted`,
        fields: input.fields.map((field) =>
          defaulted(field) ? { ...field, optional: false } : field,
        ),
      });
  }
  return result;
}

/** Nullable structural comparison without recursive trait dispatch
 * @param ctx - Rendering context
 * @param use - Canonical child use
 * @param left - Borrowed left child
 * @param right - Borrowed right child
 * @returns Rust comparison statements with early inequality
 */
function compare(ctx: RustContext, use: TypeUse, left: string, right: string): string {
  const type = node(ctx, use.id);
  const leftValue = use.nullable ? "left" : left;
  const rightValue = use.nullable ? "right" : right;
  const body =
    type.kind === "object" || type.kind === "array" || type.kind === "union"
      ? `pending.push(_Equal::${type.name}(${leftValue}, ${rightValue}));`
      : `if ${leftValue} != ${rightValue} { return false; }`;
  return use.nullable
    ? `match (${left}, ${right}) { (Some(left), Some(right)) => { ${body} }, (None, None) => {}, _ => return false }`
    : body;
}

/** Nullable debug scheduling without recursive formatter calls
 * @param ctx - Rendering context
 * @param use - Canonical child use
 * @param expression - Borrowed immediate child
 * @returns Rust debug task statements
 */
function debugUse(ctx: RustContext, use: TypeUse, expression: string): string {
  const type = node(ctx, use.id);
  const body = `pending.push(_Debug::${type.kind === "object" || type.kind === "array" || type.kind === "union" ? `Value${type.name}` : "Leaf"}(${use.nullable ? "value" : expression}));`;
  return use.nullable
    ? `match ${expression} { Some(value) => { pending.push(_Debug::Text(")")); ${body} pending.push(_Debug::Text("Some(")); }, None => pending.push(_Debug::Text("None")) }`
    : body;
}

/** Structural equality dispatch for one canonical composite
 * @param ctx - Rendering context
 * @param type - Composite declaration
 * @param ordinal - Per-call identity tag for the canonical declaration
 * @returns Rust worklist arm
 */
function equalArm(ctx: RustContext, type: Composite, ordinal: number): string {
  let body: string;
  if (type.kind === "object")
    body = type.fields
      .map((field) => {
        const left = `left.${snake(field.name)}()`;
        const right = `right.${snake(field.name)}()`;
        return field.optional
          ? `match (${left}, ${right}) { (Some(left), Some(right)) => { ${compare(ctx, field.type, "left", "right")} }, (None, None) => {}, _ => return false }`
          : compare(ctx, field.type, left, right);
      })
      .join("\n");
  else if (type.kind === "array")
    body = `if left.as_slice().len() != right.as_slice().len() { return false; } for (left, right) in left.as_slice().iter().zip(right.as_slice()) { ${compare(ctx, type.element, "left", "right")} }`;
  else body = `pending.push(_Equal::${type.name}Case(left.as_case(), right.as_case()));`;
  const identity =
    type.kind === "array" || (type.kind === "object" && ctx.shared.has(type.id))
      ? `if !seen.insert((${ordinal}_usize, std::sync::Arc::as_ptr(match left.0.as_ref() { Some(data) => data, None => panic!("broken canonical ownership invariant") }) as usize, std::sync::Arc::as_ptr(match right.0.as_ref() { Some(data) => data, None => panic!("broken canonical ownership invariant") }) as usize)) { continue; }`
      : "";
  return `_Equal::${type.name}(${type.kind === "object" && type.fields.length === 0 ? "_left, _right" : "left, right"}) => { ${identity}\n${body} },`;
}

/** Structural debug dispatch for one canonical composite
 * @param ctx - Rendering context
 * @param type - Composite declaration
 * @returns Rust worklist arm
 */
function debugArm(ctx: RustContext, type: Composite): string {
  let body: string;
  if (type.kind === "object")
    body = `pending.push(_Debug::Text(" }")); ${[...type.fields]
      .reverse()
      .map((field, reverse) => {
        const expression = `value.${snake(field.name)}()`;
        const child = field.optional
          ? `match ${expression} { Some(value) => { pending.push(_Debug::Text(")")); ${debugUse(ctx, field.type, "value")} pending.push(_Debug::Text("Some(")); }, None => pending.push(_Debug::Text("None")) }`
          : debugUse(ctx, field.type, expression);
        return `${child} pending.push(_Debug::Text(${quote(`${reverse === type.fields.length - 1 ? "" : ", "}${snake(field.name)}: `)}));`;
      })
      .join("\n")} pending.push(_Debug::Text(${quote(`${type.name} { `)}));`;
  else if (type.kind === "array")
    body = `pending.push(_Debug::Text("])")); for (index, value) in value.as_slice().iter().enumerate().rev() { ${debugUse(ctx, type.element, "value")} if index != 0 { pending.push(_Debug::Text(", ")); } } pending.push(_Debug::Text(${quote(`${type.name}([`)}));`;
  else
    body = `pending.push(_Debug::Text(")")); pending.push(_Debug::Value${type.name}Case(value.as_case())); pending.push(_Debug::Text(${quote(`${type.name}(`)}));`;
  return `_Debug::Value${type.name}(${type.kind === "object" && type.fields.length === 0 ? "_value" : "value"}) => { ${body} },`;
}

/** Iterative structural comparison with typed shared-pair memoization
 * @param ctx - Rendering context
 * @param types - Composite declarations in identity-tag order
 * @param cases - Union declarations with public cases
 * @param names - Canonical value and case names
 * @param shared - Presence of shared payload declarations
 * @returns Private equality worklist declarations
 */
function renderEquality(
  ctx: RustContext,
  types: Composite[],
  cases: UnionType[],
  names: string[],
  shared: boolean,
): string {
  return `/// Pending pairs for structural equality
enum _Equal<'a> { ${names
    .map((name) =>
      tupleVariant(name, `Structural comparison of ${name}`, [
        [`&'a ${name}`, "Borrowed left value"],
        [`&'a ${name}`, "Borrowed right value"],
      ]),
    )
    .join("\n")} }
/// Stack-safe structural equality
///
/// - root: pair of canonical values
/// - Return: equality of every presence state and leaf
fn _equal_graph(root: _Equal<'_>) -> bool {
  let mut pending = vec![root];
  ${shared ? "let mut seen = std::collections::HashSet::new();" : ""}
  while let Some(pair) = pending.pop() { match pair {
    ${types.map((type, index) => equalArm(ctx, type, index)).join("\n")}
    ${cases.map((type) => `_Equal::${type.name}Case(left, right) => match (left, right) { ${type.variants.map((variant) => `(${type.name}Case::${variant.name}(left), ${type.name}Case::${variant.name}(right)) => { ${compare(ctx, variant.type, "left", "right")} },`).join("\n")} ${type.variants.length > 1 ? "_ => return false," : ""} },`).join("\n")}
  } }
  true
}
`;
}

/** Iterative structural formatting with scalar-only formatter dispatch
 * @param ctx - Rendering context
 * @param types - Composite declarations
 * @param cases - Union declarations with public cases
 * @param names - Canonical value and case names
 * @returns Private debug worklist declarations
 */
function renderDebug(
  ctx: RustContext,
  types: Composite[],
  cases: UnionType[],
  names: string[],
): string {
  const leaves = traversalShape(ctx).leaves;
  return `/// Pending structural formatting without recursive trait dispatch
enum _Debug<'a> {
  ${tupleVariant("Text", "Structural punctuation", [["&'static str", "Contract debug label or delimiter"]])}
  ${leaves ? tupleVariant("Leaf", "Nonrecursive leaf formatting", [["&'a dyn std::fmt::Debug", "Borrowed scalar or closed value"]]) : ""}
  ${names.map((name) => tupleVariant(`Value${name}`, `Structural formatting of ${name}`, [[`&'a ${name}`, "Borrowed canonical value"]])).join("\n")}
}
/// Stack-safe canonical structural formatting
///
/// - root: borrowed canonical value
/// - formatter: caller formatting sink
/// - Return: formatting success or sink failure
fn _debug_graph(root: _Debug<'_>, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
  let mut pending = vec![root];
  while let Some(value) = pending.pop() { match value {
    _Debug::Text(text) => formatter.write_str(text)?,
    ${leaves ? "_Debug::Leaf(value) => std::fmt::Debug::fmt(value, formatter)?," : ""}
    ${types.map((type) => debugArm(ctx, type)).join("\n")}
    ${cases.map((type) => `_Debug::Value${type.name}Case(value) => match value { ${type.variants.map((variant) => `${type.name}Case::${variant.name}(value) => { pending.push(_Debug::Text(")")); ${debugUse(ctx, variant.type, "value")} pending.push(_Debug::Text(${quote(`${variant.name}(`)})); },`).join("\n")} },`).join("\n")}
  } }
  Ok(())
}
`;
}

/** Public structural traits backed by iterative worklists
 * @param names - Canonical value and case names
 * @returns Canonical equality and debug implementations
 */
function renderTraits(names: string[]): string {
  return names
    .map(
      (
        name,
      ) => `impl PartialEq for ${name} { fn eq(&self, other: &Self) -> bool { _equal_graph(_Equal::${name}(self, other)) } }
impl std::fmt::Debug for ${name} { fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { _debug_graph(_Debug::Value${name}(self), formatter) } }`,
    )
    .join("\n");
}

/** Iterative last-owner reclamation and structural traits
 * @param ctx - Complete rendering context
 * @returns Private ownership worklist and canonical trait implementations
 */
export function renderOwnership(ctx: RustContext): string {
  const types = declarations(ctx);
  if (types.length === 0) return "";
  const shared = types.filter(
    (type): type is ArrayType | ObjectType =>
      type.kind === "array" || (type.kind === "object" && ctx.shared.has(type.id)),
  );
  const cases = types.filter((type): type is UnionType => type.kind === "union");
  const names = [...types.map((type) => type.name), ...cases.map((type) => `${type.name}Case`)];
  return `${renderRelease(ctx, shared)}
${renderEquality(ctx, types, cases, names, shared.length > 0)}${renderDebug(ctx, types, cases, names)}${renderTraits(names)}
`;
}
