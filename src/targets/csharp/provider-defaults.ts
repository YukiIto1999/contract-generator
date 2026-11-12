import type {
  ArrayType,
  ContractType,
  ObjectType,
  TypeUse,
  UnionType,
} from "../../model/contract-model.js";
import { wireConstant } from "./constants.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name, pascal, quote } from "./naming.js";
import { planFields, type FieldPlan } from "./object-plan.js";
import { readUse } from "./use-codec.js";

/** Uses that a node holds directly
 * @param node - Resolved node
 * @returns Field, element and variant uses
 */
function childUses(node: ContractType): readonly TypeUse[] {
  switch (node.kind) {
    case "object":
      return node.fields.map((field) => field.type);
    case "array":
      return [node.element];
    case "union":
      return node.variants.map((variant) => variant.type);
    case "scalar":
    case "enum":
    case "literal":
      return [];
  }
}

/** Nodes below the operation inputs
 * @param c - Target context
 * @returns Identities of every node that provider acceptance can reach
 */
function reachableFromInputs(c: CSharpContext): ReadonlySet<string> {
  const reachable = new Set<string>();
  const pending = c.model.operations.map((operation) => operation.input);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (reachable.has(id)) continue;
    reachable.add(id);
    pending.push(...childUses(c.node(id)).map((use) => use.id));
  }
  return reachable;
}

/** Nodes whose graph provider acceptance must rebuild because a default can fill inside them
 * @param c - Target context
 * @returns Identities of objects with a defaulted field and of every node that holds one
 */
export function acceptanceNodes(c: CSharpContext): ReadonlySet<string> {
  const reachable = reachableFromInputs(c);
  const needs = new Set<string>();
  for (let changed = true; changed;) {
    changed = false;
    for (const id of reachable) {
      const node = c.node(id);
      const direct = node.kind === "object" && node.fields.some((f) => f.default !== undefined);
      if (needs.has(id) || !(direct || childUses(node).some((use) => needs.has(use.id)))) continue;
      needs.add(id);
      changed = true;
    }
  }
  return needs;
}

/** Method that applies provider defaults below one node
 * @param c - Target context
 * @param id - Node identity
 * @returns Escaped method identifier
 */
export function applyMethod(c: CSharpContext, id: string): string {
  return name("Apply" + c.node(id).name);
}

/** Expression that applies provider defaults to a value of a use
 * @param c - Target context
 * @param needs - Nodes that acceptance rebuilds
 * @param use - Type use of the value
 * @param expr - Side-effect-free expression of the value
 * @returns Expression of the same type with defaults applied
 */
export function applyUse(
  c: CSharpContext,
  needs: ReadonlySet<string>,
  use: TypeUse,
  expr: string,
): string {
  if (!needs.has(use.id)) return expr;
  const apply = `ProviderDefaults.${applyMethod(c, use.id)}`;
  if (!use.nullable) return `${apply}(${expr})`;
  return c.valueType(use.id)
    ? `(${expr}.HasValue ? ${apply}(${expr}.Value) : (${c.use(use)})null)`
    : `(${expr} is null ? null : ${apply}(${expr}))`;
}

/** Identifier of the lazily built default of one member
 * @param node - Owning object
 * @param plan - Field plan
 * @returns Escaped field identifier
 */
function defaultField(node: ObjectType, plan: FieldPlan): string {
  return name(node.name + pascal(plan.field.name) + "Default");
}

/** Lazily built default constant of one member
 * @param c - Target context
 * @param needs - Nodes that acceptance rebuilds
 * @param node - Owning object
 * @param plan - Field plan
 * @returns Static field declaration
 */
function defaultDeclaration(
  c: CSharpContext,
  needs: ReadonlySet<string>,
  node: ObjectType,
  plan: FieldPlan,
): string {
  const { field } = plan;
  const use = c.use(field.type);
  const verify = plan.check.call("value", "path", true, c.codec(node.id));
  const json = quote(wireConstant(c, field.type, field.default!));
  return lines(
    doc(
      `Provider default of the ${field.wireName} member of ${node.name}, built once from its exact constant`,
    ),
    `private static readonly Lazy<${use}> ${defaultField(node, plan)} = new(() => {`,
    `var built = Build<${use}>(${json}, (element, c, path, binding, encoding) => {`,
    `var value = ${readUse(c, field.type, "element", "path")};`,
    verify,
    "return value;",
    "});",
    `return ${applyUse(c, needs, field.type, "built")};`,
    "});",
  );
}

/** Replacement expression of one member while defaults apply
 * @param c - Target context
 * @param needs - Nodes that acceptance rebuilds
 * @param node - Owning object
 * @param plan - Field plan
 * @returns Argument of the private completion
 */
function memberExpression(
  c: CSharpContext,
  needs: ReadonlySet<string>,
  node: ObjectType,
  plan: FieldPlan,
): string {
  const { field } = plan;
  const source = `value.${plan.property}`;
  if (!field.optional) return applyUse(c, needs, field.type, source);
  const present = `Presence<${c.use(field.type)}>.Present`;
  const applied = `${present}(${applyUse(c, needs, field.type, `${source}.Value`)})`;
  if (field.default !== undefined)
    return `${source}.IsPresent ? ${applied} : ${present}(${defaultField(node, plan)}.Value)`;
  return needs.has(field.type.id) ? `${source}.IsPresent ? ${applied} : ${source}` : source;
}

/** Default application over one object
 * @param c - Target context
 * @param needs - Nodes that acceptance rebuilds
 * @param node - Resolved object
 * @returns Method declaration
 */
function applyObject(c: CSharpContext, needs: ReadonlySet<string>, node: ObjectType): string {
  const t = c.type(node.id);
  const plans = planFields(c, node);
  return lines(
    doc(
      `Provider default application below ${node.name}`,
      [["value", "Validated object"]],
      "Object with omitted defaulted members filled",
    ),
    `internal static ${t} ${applyMethod(c, node.id)}(${t} value) =>`,
    `${t}.Complete(${plans.map((plan) => memberExpression(c, needs, node, plan)).join(", ")});`,
  );
}

/** Default application over the elements of one array
 * @param c - Target context
 * @param needs - Nodes that acceptance rebuilds
 * @param node - Resolved array
 * @returns Method declaration
 */
function applyArray(c: CSharpContext, needs: ReadonlySet<string>, node: ArrayType): string {
  const t = c.type(node.id);
  return lines(
    doc(
      `Provider default application below ${node.name}`,
      [["value", "Validated array"]],
      "Array whose elements have omitted defaulted members filled",
    ),
    `internal static ${t} ${applyMethod(c, node.id)}(${t} value) {`,
    `var builder = ImmutableArray.CreateBuilder<${c.use(node.element)}>(value.Length);`,
    `foreach (var item in value) builder.Add(${applyUse(c, needs, node.element, "item")});`,
    "return builder.MoveToImmutable();",
    "}",
  );
}

/** Default application over the variants of one union
 * @param c - Target context
 * @param needs - Nodes that acceptance rebuilds
 * @param node - Resolved union
 * @returns Method declaration
 */
function applyUnion(c: CSharpContext, needs: ReadonlySet<string>, node: UnionType): string {
  const t = c.type(node.id);
  return lines(
    doc(
      `Provider default application below ${node.name}`,
      [["value", "Validated union"]],
      "Union whose payload has omitted defaulted members filled",
    ),
    `internal static ${t} ${applyMethod(c, node.id)}(${t} value) {`,
    ...node.variants
      .filter((variant) => needs.has(variant.type.id))
      .map((variant, index) => {
        const record = `${t}.${name(pascal(variant.name))}`;
        return `if (value is ${record} variant${index}) return ${record}.Complete(${applyUse(c, needs, variant.type, `variant${index}.Value`)});`;
      }),
    "return value;",
    "}",
  );
}

/** Default application over one node
 * @param c - Target context
 * @param needs - Nodes that acceptance rebuilds
 * @param node - Resolved node that holds a default somewhere below it
 * @returns Declarations of the node's defaults and its application method
 */
function applyNode(c: CSharpContext, needs: ReadonlySet<string>, node: ContractType): string {
  switch (node.kind) {
    case "object":
      return lines(
        ...planFields(c, node)
          .filter((plan) => plan.field.default !== undefined)
          .map((plan) => defaultDeclaration(c, needs, node, plan)),
        applyObject(c, needs, node),
      );
    case "array":
      return applyArray(c, needs, node);
    case "union":
      return applyUnion(c, needs, node);
    case "scalar":
    case "enum":
    case "literal":
      return "";
  }
}

/** Provider default application at every depth of every operation input
 * @param c - Target context
 * @param needs - Nodes that acceptance rebuilds
 * @returns Internal static class, or nothing when no default exists below an input
 */
export function renderProviderDefaults(c: CSharpContext, needs: ReadonlySet<string>): string {
  if (needs.size === 0) return "";
  return lines(
    doc("Provider-only default application that clients and plain codecs never perform"),
    "internal static class ProviderDefaults {",
    doc(
      "Default construction from its exact constant",
      [
        ["json", "HTTP-encoded constant accepted by the profile"],
        ["read", "Generated reader of the member"],
      ],
      "Completed default",
      {
        typeParams: [["T", "Member representation"]],
        throws: [
          ["InvalidOperationException", "A generated default that its own contract rejects"],
        ],
      },
    ),
    "private static T Build<T>(string json, Func<JsonElement, ReadContext, string, string, string?, T> read) {",
    `var result = Wire.Decode(json, read, "http");`,
    `return result is Result<Accepted<T>, ContractFailure>.Succeeded accepted ? accepted.Value.Value : throw new InvalidOperationException("Invalid generated provider default");`,
    "}",
    ...c.model.types.filter((node) => needs.has(node.id)).map((node) => applyNode(c, needs, node)),
    "}",
  );
}
