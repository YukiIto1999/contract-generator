import type { ContractModel, ContractType, ObjectType } from "../../model/contract-model.js";
import { defaulted } from "./accepting.js";
import { sharedObjects } from "./layout.js";

/** Maximum storage-path contribution of one object declaration
 * @param type - Canonical object declaration
 * @param shared - Objects emitted with private shared payloads
 * @param effective - Provider-strengthened default presence
 * @returns Nominal storage layers including the deepest member presence
 */
function objectLayers(type: ObjectType, shared: ReadonlySet<string>, effective = false): number {
  let presence = 0;
  for (const field of type.fields) {
    const optional = field.optional && !(effective && defaulted(field));
    presence = Math.max(presence, Number(optional) + Number(field.type.nullable));
  }
  return 1 + (shared.has(type.id) ? 3 : 0) + presence;
}

/** Maximum storage-path contribution of one canonical declaration
 * @param type - Normalized declaration
 * @param shared - Objects emitted with private shared payloads
 * @returns Nominal storage layers including outgoing presence wrappers
 */
function declarationLayers(type: ContractType, shared: ReadonlySet<string>): number {
  switch (type.kind) {
    case "object":
      return objectLayers(type, shared);
    case "array":
      return 4 + Number(type.element.nullable);
    case "union":
      return 2 + Number(type.variants.some((variant) => variant.type.nullable));
    case "scalar":
    case "literal":
    case "enum":
      return 1;
  }
}

/** Crate-local compile-time allowance for the finite generated declaration topology
 * @param model - Complete normalized contract without expanding recursive references
 * @returns Rust default reserve plus a conservative sum of nominal storage-path contributions
 * @throws {@link Error} Missing normalized object field declaration
 * @see https://doc.rust-lang.org/reference/attributes/limits.html
 * @see https://doc.rust-lang.org/error_codes/E0320.html
 */
export function rustRecursionLimit(model: ContractModel): number {
  const nodes = new Map(model.types.map((type) => [type.id, type]));
  const shared = sharedObjects(model.types, nodes);
  let limit = 128;
  for (const type of model.types) limit += declarationLayers(type, shared);
  for (const operation of model.operations) {
    const input = nodes.get(operation.input);
    if (input?.kind === "object" && input.fields.some(defaulted))
      limit += objectLayers(input, shared, true);
  }
  return limit;
}
