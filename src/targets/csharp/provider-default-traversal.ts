import type { ContractType } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name } from "./naming.js";

/** Member of the traversal state that holds the settled results of one node
 * @param c - Target context
 * @param id - Node identity
 * @returns Escaped member identifier
 */
export function knownMember(c: CSharpContext, id: string): string {
  return name(c.node(id).name + "Known");
}

/** Map type of the settled results of one node, keyed by the accepted input child
 * @param c - Target context
 * @param id - Node identity
 * @returns Dictionary type whose value holds the applied child and its changed flag
 */
export function knownType(c: CSharpContext, id: string): string {
  const t = c.type(id);
  return `global::System.Collections.Generic.Dictionary<${t}, (${t} Applied, bool Changed)>`;
}

/** Comparer that keys a settled result by the identity of the accepted input child
 * @param c - Target context
 * @param id - Node identity
 * @returns Reference comparer of an object or union, storage comparer of an array
 */
function identity(c: CSharpContext, id: string): string {
  return c.node(id).kind === "array"
    ? `${c.type(id)}.StorageIdentity`
    : "global::System.Collections.Generic.ReferenceEqualityComparer.Instance";
}

/** Traversal state class holding the work stack and one lazily created identity map per node
 * @param c - Target context
 * @param nodes - Nodes that acceptance rebuilds
 * @returns Private nested class declaration
 */
export function renderTraversal(c: CSharpContext, nodes: readonly ContractType[]): string {
  return lines(
    doc("Private state of one default application with its work stack and settled child results"),
    "private sealed class Traversal {",
    doc("Private traversal work stack", [], undefined, { value: "Deferred traversal steps" }),
    "internal global::System.Collections.Generic.Stack<Action> Pending { get; } = new();",
    ...nodes.map((node) => {
      const type = knownType(c, node.id);
      const field = name("_" + node.name + "Known");
      return lines(
        doc(`Backing map of applied ${node.name} children`),
        `private ${type}? ${field};`,
        doc(`Applied ${node.name} children by input identity`, [], undefined, {
          value: "Identity-keyed results created on first use",
        }),
        `internal ${type} ${knownMember(c, node.id)} => ${field} ??= new(${identity(c, node.id)});`,
      );
    }),
    "}",
  );
}

/** Completion helpers shared by every typed step
 * @param nodes - Nodes that acceptance rebuilds
 * @param needs - Identities of the nodes that acceptance rebuilds
 * @returns Result recording helper, and the unchanged-variant helper when a union has a variant that no default reaches
 */
export function renderSettlement(
  nodes: readonly ContractType[],
  needs: ReadonlySet<string>,
): string {
  const unchanged = nodes.some(
    (node) => node.kind === "union" && node.variants.some((variant) => !needs.has(variant.type.id)),
  );
  return lines(
    doc(
      "Recording of one settled child result for every further reference to the same input child",
      [
        ["known", "Settled results of this node"],
        ["value", "Input child that keys the result"],
        ["applied", "Child with defaults applied, the input child when nothing changed"],
        ["changed", "Whether applying defaults replaced the child"],
        ["complete", "Typed completion receiving the changed flag"],
      ],
      undefined,
      { typeParams: [["T", "Child representation"]] },
    ),
    "private static void Settle<T>(global::System.Collections.Generic.Dictionary<T, (T Applied, bool Changed)> known, T value, T applied, bool changed, Action<T, bool> complete) where T : notnull {",
    "known[value] = (applied, changed);",
    "complete(applied, changed);",
    "}",
    unchanged &&
      lines(
        doc(
          "Completion of a variant whose payload no default reaches",
          [
            ["complete", "Typed completion receiving the changed flag"],
            ["value", "Union value that stays unchanged"],
          ],
          "Completed variant step",
          { typeParams: [["T", "Union representation"]] },
        ),
        "private static global::TypeModeling.Domain.Unit Unchanged<T>(Action<T, bool> complete, T value) {",
        "complete(value, false);",
        "return global::TypeModeling.Domain.Unit.Value;",
        "}",
      ),
  );
}
