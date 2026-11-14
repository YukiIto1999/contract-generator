import { doc } from "./naming.js";

/** Tuple variant with contract text confined to Rustdoc
 * @param name - Rust variant identifier
 * @param description - Variant contract
 * @param fields - Ordered Rust field types and contracts
 * @returns Rust variant declaration with field documentation
 */
export function tupleVariant(
  name: string,
  description: string,
  fields: readonly (readonly [string, string])[],
): string {
  return `${doc(description, "")}\n${name}(\n${fields.map(([type, contract]) => `${doc(contract, "")}\n${type},`).join("\n")}\n),`;
}

/** Named variant with contract text confined to Rustdoc
 * @param name - Rust variant identifier
 * @param description - Variant contract
 * @param fields - Rust field names with their types and contracts
 * @returns Rust variant declaration with field documentation
 */
export function recordVariant(
  name: string,
  description: string,
  fields: readonly (readonly [string, string, string])[],
): string {
  return `${doc(description, "")}\n${name} {\n${fields.map(([field, type, contract]) => `${doc(contract, "")}\n${field}: ${type},`).join("\n")}\n},`;
}
