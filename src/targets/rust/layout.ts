import type { ContractType, TypeUse } from "../../model/contract-model.js";

/** Value-layout dependency of an object field or union case on another inline declaration */
interface InlineEdge {
  /** Declaration storing the use inline */
  readonly from: string;
  /** Declaration the use refers to */
  readonly to: string;
  /** Use whose storage may need indirection */
  readonly use: TypeUse;
  /** Union case payload rather than object field */
  readonly variant: boolean;
}

/** Inline value-layout edges between objects and unions; arrays own heap storage and end every chain
 * @param types - Complete declaration set
 * @param nodes - Declarations by identity
 * @returns Edges in deterministic declaration order
 */
function inlineEdges(
  types: readonly ContractType[],
  nodes: ReadonlyMap<string, ContractType>,
): InlineEdge[] {
  const edges: InlineEdge[] = [];
  for (const type of types) {
    const uses =
      type.kind === "object"
        ? type.fields.map((field) => ({ use: field.type, variant: false }))
        : type.kind === "union"
          ? type.variants.map((variant) => ({ use: variant.type, variant: true }))
          : [];
    for (const { use, variant } of uses) {
      const kind = nodes.get(use.id)?.kind;
      if (kind === "object" || kind === "union")
        edges.push({ from: type.id, to: use.id, use, variant });
    }
  }
  return edges;
}

/** Whether a declaration reaches another through inline edges
 * @param edges - Inline edges considered present
 * @param start - Declaration to leave
 * @param goal - Declaration to arrive at
 * @returns Reachability including the empty path
 */
function reaches(edges: readonly InlineEdge[], start: string, goal: string): boolean {
  const seen = new Set<string>();
  const pending = [start];
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    if (id === goal) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const edge of edges) if (edge.from === id) pending.push(edge.to);
  }
  return false;
}

/** Uses stored behind `Box` so every recursive declaration has a finite size
 * @param types - Complete declaration set
 * @param nodes - Declarations by identity
 * @returns Uses whose referenced declaration is boxed; union cases are boxed before object fields
 */
export function boxedUses(
  types: readonly ContractType[],
  nodes: ReadonlyMap<string, ContractType>,
): ReadonlySet<TypeUse> {
  const edges = inlineEdges(types, nodes);
  const cases = edges.filter((edge) => edge.variant && reaches(edges, edge.to, edge.from));
  const remaining = edges.filter((edge) => !cases.includes(edge));
  const fields = remaining.filter((edge) => reaches(remaining, edge.to, edge.from));
  return new Set([...cases, ...fields].map((edge) => edge.use));
}
