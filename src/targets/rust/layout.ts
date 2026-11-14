import type { ContractType } from "../../model/contract-model.js";

/** Object declarations whose immutable payload requires shared ownership
 * @param types - Complete declaration set
 * @param nodes - Declarations by identity
 * @returns Objects containing a composite or variable-sized scalar
 * @throws {@link Error} Missing normalized field declaration
 */
export function sharedObjects(
  types: readonly ContractType[],
  nodes: ReadonlyMap<string, ContractType>,
): ReadonlySet<string> {
  return new Set(
    types
      .filter(
        (type) =>
          type.kind === "object" &&
          type.fields.some((field) => {
            const child = nodes.get(field.type.id);
            if (child === undefined)
              throw new Error(`Invalid normalized model reference ${field.type.id}`);
            if (child.kind === "object" || child.kind === "array" || child.kind === "union")
              return true;
            return (
              child.kind === "scalar" &&
              (!["boolean", "int32", "int64", "uint64", "float32", "float64"].includes(
                child.scalar,
              ) ||
                (child.scalar !== "boolean" && child.preserveLexical))
            );
          }),
      )
      .map((type) => type.id),
  );
}
