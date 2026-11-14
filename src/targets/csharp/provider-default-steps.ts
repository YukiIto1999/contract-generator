import type {
  ArrayType,
  ObjectType,
  TypeUse,
  UnionType,
  Variant,
} from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name, pascal } from "./naming.js";
import { planFields, type FieldPlan } from "./object-plan.js";
import { defaultField } from "./provider-default-plan.js";
import { knownMember, knownType } from "./provider-default-traversal.js";

/** Identifier of one typed trampoline step
 * @param c - Target context
 * @param id - Node identity
 * @returns Escaped method identifier
 */
export function scheduleMethod(c: CSharpContext, id: string): string {
  return name("Schedule" + c.node(id).name);
}

/** Identifier of the step that traverses one variant payload of a union
 * @param node - Resolved union
 * @param variant - Variant whose payload a default reaches
 * @returns Escaped method identifier
 */
function variantMethod(node: UnionType, variant: Variant): string {
  return name("Schedule" + node.name + "Variant" + pascal(variant.name));
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
  const schedule = `work.Pending.Push(() => ${scheduleMethod(c, use.id)}(${child}, work, ${callback}));`;
  if (!use.nullable) return schedule;
  return lines(
    "{",
    `if (${source} is { } child) { ${schedule} }`,
    absent ? `else { ${absent} }` : "",
    "}",
  );
}

/** Lookup that ends a step at once when the same input child was already settled
 * @param c - Target context
 * @param id - Node identity
 * @returns Lookup statements that declare `known`
 */
export function settledLookup(c: CSharpContext, id: string): string {
  return lines(
    `var known = work.${knownMember(c, id)};`,
    "if (known.TryGetValue(value, out var settled)) { complete(settled.Applied, settled.Changed); return; }",
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
export function applyObject(
  c: CSharpContext,
  needs: ReadonlySet<string>,
  node: ObjectType,
): string {
  const plans = planFields(c, node);
  const t = c.type(node.id);
  const members = plans.map((plan) => `f${plan.index}`).join(", ");
  return lines(
    "var changed = false;",
    ...plans.map((plan) => `var f${plan.index} = value.${plan.property};`),
    `work.Pending.Push(() => Settle<${t}>(known, value, changed ? ${t}.Complete(${members}) : value, changed, complete));`,
    ...plans.map((plan) => scheduleMember(c, needs, node, plan)),
  );
}

/** Deferred array traversal with copy-on-change storage
 * @param c - Target context
 * @param node - Resolved array
 * @returns Trampoline step body
 */
export function applyArray(c: CSharpContext, node: ArrayType): string {
  const t = c.type(node.id);
  const element = c.use(node.element);
  return lines(
    `ImmutableArray<${element}>.Builder? builder = null;`,
    "var index = 0;",
    "void Next() {",
    `if (index == value.Length) { Settle<${t}>(known, value, builder is null ? value : ${t}.Complete(builder.MoveToImmutable()), builder is not null, complete); return; }`,
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
        `builder = ImmutableArray.CreateBuilder<${element}>(value.Length);`,
        "foreach (var original in value) builder.Add(original);",
        "}",
        "builder[position] = applied;",
        "}",
        "work.Pending.Push(Next);",
        "}",
      ),
      "work.Pending.Push(Next);",
    ),
    "}",
    "work.Pending.Push(Next);",
  );
}

/** Closed-hierarchy dispatch that every variant must handle
 * @param c - Target context
 * @param needs - Nodes that acceptance traverses
 * @param node - Resolved union
 * @returns Trampoline step body as a switch expression without a catchall arm
 */
export function applyUnion(c: CSharpContext, needs: ReadonlySet<string>, node: UnionType): string {
  const t = c.type(node.id);
  return lines(
    "_ = value switch {",
    ...node.variants.map((variant) => {
      const record = `${t}.${name(pascal(variant.name))}`;
      return needs.has(variant.type.id)
        ? `${record} variant => ${variantMethod(node, variant)}(variant, work, known, complete),`
        : `${record} => Unchanged(complete, value),`;
    }),
    "};",
  );
}

/** Deferred traversal of the payload of one union variant that a default reaches
 * @param c - Target context
 * @param node - Resolved union
 * @param variant - Variant whose payload a default reaches
 * @returns Method declaration returning a unit so that the dispatch stays an expression
 */
export function variantStep(c: CSharpContext, node: UnionType, variant: Variant): string {
  const t = c.type(node.id);
  const record = `${t}.${name(pascal(variant.name))}`;
  return lines(
    doc(
      `Deferred provider default application below the ${variant.tag} variant of ${node.name}`,
      [
        ["variant", "Validated variant"],
        ["work", "Private traversal state"],
        ["known", "Settled results of this union"],
        ["complete", "Typed completion receiving the changed flag"],
      ],
      "Completed variant step",
    ),
    `private static global::TypeModeling.Domain.Unit ${variantMethod(node, variant)}(${record} variant, Traversal work, ${knownType(c, node.id)} known, Action<${t}, bool> complete) {`,
    scheduleUse(
      c,
      variant.type,
      "variant.Value",
      `(applied, changed) => work.Pending.Push(() => Settle<${t}>(known, variant, changed ? ${record}.Complete(applied) : variant, changed, complete))`,
      "complete(variant, false);",
    ),
    "return global::TypeModeling.Domain.Unit.Value;",
    "}",
  );
}
