import type { ContractType, ObjectType, TypeUse } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { name, pascal } from "./naming.js";
import type { FieldPlan } from "./object-plan.js";

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

/** Identifier of the unexpanded default constant of one member
 * @param node - Owning object
 * @param plan - Field plan
 * @returns Escaped field identifier
 */
export function defaultField(node: ObjectType, plan: FieldPlan): string {
  return name(node.name + pascal(plan.field.name) + "Default");
}
