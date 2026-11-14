import type { ContractType, ObjectType } from "../../model/contract-model.js";
import { wireConstant } from "./constants.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, quote } from "./naming.js";
import { planFields, type FieldPlan } from "./object-plan.js";
import { applyMethod, defaultField } from "./provider-default-plan.js";
import {
  applyArray,
  applyObject,
  applyUnion,
  scheduleMethod,
  settledLookup,
  variantStep,
} from "./provider-default-steps.js";
import { renderSettlement, renderTraversal } from "./provider-default-traversal.js";
import { readUse } from "./use-codec.js";

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

/** Default application entrypoint for an operation input
 * @param c - Target context
 * @param node - Operation input that contains a default
 * @returns Internal entrypoint owning one traversal
 */
function applyInput(c: CSharpContext, node: ContractType): string {
  const t = c.type(node.id);
  return lines(
    doc(
      `Stack-safe provider default application below ${node.name}`,
      [["value", "Validated value"]],
      "Value with omitted defaulted members filled",
    ),
    `internal static ${t} ${applyMethod(c, node.id)}(${t} value) {`,
    "var work = new Traversal();",
    "var result = value;",
    `${scheduleMethod(c, node.id)}(value, work, (applied, _) => result = applied);`,
    "while (work.Pending.TryPop(out var next)) next();",
    "return result;",
    "}",
  );
}

/** Default application over one node
 * @param c - Target context
 * @param needs - Nodes that acceptance rebuilds
 * @param node - Resolved node that holds a default somewhere below it
 * @returns Declarations of the node's defaults and its typed step
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
    doc(`Deferred provider default application below ${node.name}`, [
      ["value", "Validated value"],
      ["work", "Private traversal state"],
      ["complete", "Typed completion receiving the changed flag"],
    ]),
    `private static void ${scheduleMethod(c, node.id)}(${t} value, Traversal work, Action<${t}, bool> complete) {`,
    settledLookup(c, node.id),
    node.kind === "object"
      ? applyObject(c, needs, node)
      : node.kind === "array"
        ? applyArray(c, node)
        : applyUnion(c, needs, node),
    "}",
    ...(node.kind === "union"
      ? node.variants
          .filter((variant) => needs.has(variant.type.id))
          .map((variant) => variantStep(c, node, variant))
      : []),
  );
}

/** Provider default application at every depth of every operation input
 * @param c - Target context
 * @param needs - Nodes that acceptance rebuilds
 * @returns Internal static class, or nothing when no default exists below an input
 */
export function renderProviderDefaults(c: CSharpContext, needs: ReadonlySet<string>): string {
  if (needs.size === 0) return "";
  const nodes = c.model.types.filter((node) => needs.has(node.id));
  const inputs = new Set(c.model.operations.map((operation) => operation.input));
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
    renderTraversal(c, nodes),
    renderSettlement(nodes, needs),
    ...nodes.map((node) =>
      lines(inputs.has(node.id) && applyInput(c, node), applyNode(c, needs, node)),
    ),
    "}",
  );
}
