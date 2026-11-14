import type { ContractType, TypeUse } from "../../model/contract-model.js";
import type { RustContext } from "./context.js";

/** Reachable private codec work without unrelated exported leaves */
export interface TraversalShape {
  /** Composite roots and their referenced leaves */
  readonly types: readonly ContractType[];
  /** Direct member uses of every composite root */
  readonly uses: readonly TypeUse[];
  /** Presence of a scalar or closed leaf task */
  readonly leaves: boolean;
  /** Presence of a nullable member task */
  readonly nullable: boolean;
  /** Presence of an omittable object member */
  readonly missing: boolean;
}

/** Work variants required by the complete set of public composite codecs
 * @param ctx - Complete rendering context
 * @returns Reachable codec declarations and required presence states
 */
export function traversalShape(ctx: RustContext): TraversalShape {
  const reachable = new Set<string>();
  const uses: TypeUse[] = [];
  let missing = false;
  for (const type of ctx.model.types) {
    if (type.kind === "object") {
      reachable.add(type.id);
      for (const field of type.fields) {
        uses.push(field.type);
        missing ||= field.optional;
      }
    } else if (type.kind === "array") {
      reachable.add(type.id);
      uses.push(type.element);
    } else if (type.kind === "union") {
      reachable.add(type.id);
      for (const variant of type.variants) uses.push(variant.type);
    }
  }
  for (const use of uses) reachable.add(use.id);
  const types = ctx.model.types.filter((type) => reachable.has(type.id));
  return {
    types,
    uses,
    leaves: types.some(
      (type) => type.kind === "scalar" || type.kind === "enum" || type.kind === "literal",
    ),
    nullable: uses.some((use) => use.nullable),
    missing,
  };
}
