import type { ContractModel, ContractType, Field, TypeUse } from "../../model/contract-model.js";

/** Optional member that provider acceptance fills when it is omitted
 * @param field - Contract field
 * @returns Whether acceptance supplies a default for the field
 */
export function defaulted(field: Field): boolean {
  return field.optional && field.default !== undefined;
}

/** Values nested directly inside a declaration
 * @param type - Resolved declaration
 * @returns Uses of its fields, elements or union cases
 */
function children(type: ContractType): readonly TypeUse[] {
  switch (type.kind) {
    case "object":
      return type.fields.map((field) => field.type);
    case "array":
      return [type.element];
    case "union":
      return type.variants.map((variant) => variant.type);
    case "scalar":
    case "enum":
    case "literal":
      return [];
  }
}

/** Declarations reachable from the input of a published operation
 * @param model - Complete contract
 * @param nodes - Declarations by identity
 * @returns Identities of the inputs and everything nested below them
 */
function inputReachable(
  model: ContractModel,
  nodes: ReadonlyMap<string, ContractType>,
): ReadonlySet<string> {
  const seen = new Set<string>();
  const pending = model.operations.map((operation) => operation.input);
  for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
    const type = nodes.get(id);
    if (type === undefined || seen.has(id)) continue;
    seen.add(id);
    pending.push(...children(type).map((use) => use.id));
  }
  return seen;
}

/** Declarations whose accepted values contain a provider default at any depth
 * @param model - Complete contract
 * @param nodes - Declarations by identity
 * @returns Identities of input-reachable declarations that provider acceptance must rebuild
 */
export function acceptingTypes(
  model: ContractModel,
  nodes: ReadonlyMap<string, ContractType>,
): ReadonlySet<string> {
  const candidates = [...inputReachable(model, nodes)].flatMap((id) => nodes.get(id) ?? []);
  const accepting = new Set<string>();
  for (let grew = true; grew;) {
    grew = false;
    for (const type of candidates) {
      if (accepting.has(type.id)) continue;
      const direct = type.kind === "object" && type.fields.some(defaulted);
      if (!direct && !children(type).some((use) => accepting.has(use.id))) continue;
      accepting.add(type.id);
      grew = true;
    }
  }
  return accepting;
}
