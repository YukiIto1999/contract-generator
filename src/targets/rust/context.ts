import type { ContractModel, ContractType, TypeUse } from "../../model/contract-model.js";
import { acceptingTypes } from "./accepting.js";
import { boxedUses } from "./layout.js";

/** Rust declaration context with stable resolved identities */
export interface RustContext {
  /** Complete deterministic contract */
  readonly model: ContractModel;
  /** Declarations by stable identity */
  readonly nodes: ReadonlyMap<string, ContractType>;
  /** Cargo package prefix of the generated dependency units */
  readonly prefix: string;
  /** Uses stored behind `Box` to give recursive declarations a finite size */
  readonly boxed: ReadonlySet<TypeUse>;
  /** Input-reachable declarations that provider acceptance rebuilds to apply defaults */
  readonly accepting: ReadonlySet<string>;
}

/** Rendering context derived once from a normalized contract
 * @param model - Complete deterministic contract
 * @param prefix - Cargo package prefix
 * @returns Context with layout and acceptance analysis
 */
export function createContext(model: ContractModel, prefix: string): RustContext {
  const nodes = new Map(model.types.map((type) => [type.id, type]));
  return {
    model,
    nodes,
    prefix,
    boxed: boxedUses(model.types, nodes),
    accepting: acceptingTypes(model, nodes),
  };
}

/** Resolved node lookup with compiler-independent identity
 * @param ctx - Rendering context
 * @param id - Normalized node identity
 * @returns Resolved declaration
 * @throws Error when the identity is absent, which the model validation rules out
 */
export function node(ctx: RustContext, id: string): ContractType {
  const found = ctx.nodes.get(id);
  if (!found) throw new Error(`Invalid normalized model reference ${id}`);
  return found;
}
