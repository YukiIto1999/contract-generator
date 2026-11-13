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
import { applyMethod } from "./provider-default-plan.js";
import { readUse } from "./use-codec.js";

/** Identifier of the unexpanded default constant of one member
 * @param node - Owning object
 * @param plan - Field plan
 * @returns Escaped field identifier
 */
function defaultField(node: ObjectType, plan: FieldPlan): string {
  return name(node.name + pascal(plan.field.name) + "Default");
}

/** Lazily decoded default constant without dependent default expansion
 * @param c - Target context
 * @param node - Owning object
 * @param plan - Field plan
 * @returns Static field declaration
 */
function defaultDeclaration(c: CSharpContext, node: ObjectType, plan: FieldPlan): string {
  const { field } = plan;
  const use = c.use(field.type);
  const verify = plan.check.call("value", "path", true, c.codec(node.id));
  const json = quote(wireConstant(c, field.type, field.default!));
  return lines(
    doc(`Unexpanded provider default of the ${field.wireName} member of ${node.name}`),
    `private static readonly Lazy<${use}> ${defaultField(node, plan)} = new(() =>`,
    `Build<${use}>(${json}, (element, c, path, binding, encoding) => {`,
    `var value = ${readUse(c, field.type, "element", "path")};`,
    verify,
    "return value;",
    "}));",
  );
}

/** Identifier of one typed trampoline step
 * @param c - Target context
 * @param id - Node identity
 * @returns Escaped method identifier
 */
function scheduleMethod(c: CSharpContext, id: string): string {
  return name("Schedule" + c.node(id).name);
}

/** Deferred child traversal with nullable values left intact
 * @param c - Target context
 * @param use - Child type
 * @param source - Stable child expression
 * @param callback - Typed completion callback
 * @param absent - Completion statement for a null child
 * @returns Scheduling statements
 */
function scheduleUse(
  c: CSharpContext,
  use: TypeUse,
  source: string,
  callback: string,
  absent = "",
): string {
  const child = use.nullable ? "child" : source;
  const schedule = `pending.Push(() => ${scheduleMethod(c, use.id)}(${child}, pending, ${callback}));`;
  if (!use.nullable) return schedule;
  return lines(
    "{",
    `if (${source} is { } child) { ${schedule} }`,
    absent ? `else { ${absent} }` : "",
    "}",
  );
}

/** One object's field traversal without recursive default dependencies
 * @param c - Target context
 * @param needs - Nodes that acceptance traverses
 * @param node - Resolved object
 * @param plan - Field plan
 * @returns Field initialization and deferred traversal
 */
function scheduleMember(
  c: CSharpContext,
  needs: ReadonlySet<string>,
  node: ObjectType,
  plan: FieldPlan,
): string {
  const { field, index } = plan;
  const local = `f${index}`;
  const source = field.optional ? `${local}.Value` : local;
  const present = `Presence<${c.use(field.type)}>.Present`;
  const scheduled = needs.has(field.type.id)
    ? scheduleUse(
        c,
        field.type,
        source,
        `(applied, childChanged) => { if (childChanged) { ${local} = ${field.optional ? `${present}(applied)` : "applied"}; changed = true; } }`,
      )
    : "";
  return lines(
    field.optional && field.default !== undefined
      ? `if (!${local}.IsPresent) { ${local} = ${present}(${defaultField(node, plan)}.Value); changed = true; }`
      : "",
    scheduled && field.optional ? `if (${local}.IsPresent) { ${scheduled} }` : scheduled,
  );
}

/** Deferred object completion preserving unchanged accepted instances
 * @param c - Target context
 * @param needs - Nodes that acceptance traverses
 * @param node - Resolved object
 * @returns Trampoline step body
 */
function applyObject(c: CSharpContext, needs: ReadonlySet<string>, node: ObjectType): string {
  const plans = planFields(c, node);
  return lines(
    "var changed = false;",
    ...plans.map((plan) => `var f${plan.index} = value.${plan.property};`),
    `pending.Push(() => complete(changed ? ${c.type(node.id)}.Complete(${plans.map((plan) => `f${plan.index}`).join(", ")}) : value, changed));`,
    ...plans.map((plan) => scheduleMember(c, needs, node, plan)),
  );
}

/** Deferred array traversal with copy-on-change storage
 * @param c - Target context
 * @param node - Resolved array
 * @returns Trampoline step body
 */
function applyArray(c: CSharpContext, node: ArrayType): string {
  return lines(
    `ImmutableArray<${c.use(node.element)}>.Builder? builder = null;`,
    "var index = 0;",
    "void Next() {",
    `if (index == value.Length) { complete(builder is null ? value : ${c.type(node.id)}.Complete(builder.MoveToImmutable()), builder is not null); return; }`,
    "var position = index++;",
    "var item = value[position];",
    scheduleUse(
      c,
      node.element,
      "item",
      lines(
        "(applied, changed) => {",
        "if (changed) {",
        "if (builder is null) {",
        `builder = ImmutableArray.CreateBuilder<${c.use(node.element)}>(value.Length);`,
        "foreach (var original in value) builder.Add(original);",
        "}",
        "builder[position] = applied;",
        "}",
        "pending.Push(Next);",
        "}",
      ),
      "pending.Push(Next);",
    ),
    "}",
    "pending.Push(Next);",
  );
}

/** Deferred union traversal preserving unchanged accepted variants
 * @param c - Target context
 * @param needs - Nodes that acceptance traverses
 * @param node - Resolved union
 * @returns Trampoline step body
 */
function applyUnion(c: CSharpContext, needs: ReadonlySet<string>, node: UnionType): string {
  const t = c.type(node.id);
  return lines(
    "switch (value) {",
    ...node.variants.map((variant, index) => {
      const record = `${t}.${name(pascal(variant.name))}`;
      const value = `variant${index}`;
      return lines(
        `case ${record} ${value}:`,
        needs.has(variant.type.id)
          ? scheduleUse(
              c,
              variant.type,
              `${value}.Value`,
              `(applied, changed) => pending.Push(() => complete(changed ? ${record}.Complete(applied) : value, changed))`,
              "complete(value, false);",
            )
          : "complete(value, false);",
        "break;",
      );
    }),
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
  if (node.kind !== "object" && node.kind !== "array" && node.kind !== "union") return "";
  const t = c.type(node.id);
  return lines(
    ...(node.kind === "object"
      ? planFields(c, node)
          .filter((plan) => plan.field.default !== undefined)
          .map((plan) => defaultDeclaration(c, node, plan))
      : []),
    doc(
      `Stack-safe provider default application below ${node.name}`,
      [["value", "Validated value"]],
      "Value with omitted defaulted members filled",
    ),
    `internal static ${t} ${applyMethod(c, node.id)}(${t} value) {`,
    "var pending = new global::System.Collections.Generic.Stack<Action>();",
    "var result = value;",
    `${scheduleMethod(c, node.id)}(value, pending, (applied, _) => result = applied);`,
    "while (pending.TryPop(out var next)) next();",
    "return result;",
    "}",
    doc(`Deferred provider default application below ${node.name}`, [
      ["value", "Validated value"],
      ["pending", "Private traversal work stack"],
      ["complete", "Typed completion receiving the changed flag"],
    ]),
    `private static void ${scheduleMethod(c, node.id)}(${t} value, global::System.Collections.Generic.Stack<Action> pending, Action<${t}, bool> complete) {`,
    node.kind === "object"
      ? applyObject(c, needs, node)
      : node.kind === "array"
        ? applyArray(c, node)
        : applyUnion(c, needs, node),
    "}",
  );
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
    "private static T Build<T>(string json, Func<JsonElement, ReadContext, Wire.Path, string, string?, T> read) {",
    "using var document = Wire.Parse(json);",
    "var context = new ReadContext();",
    `var value = read(document.RootElement, context, "", "http", null);`,
    `return context.IsValid ? value : throw new InvalidOperationException("Invalid generated provider default");`,
    "}",
    ...c.model.types.filter((node) => needs.has(node.id)).map((node) => applyNode(c, needs, node)),
    "}",
  );
}
