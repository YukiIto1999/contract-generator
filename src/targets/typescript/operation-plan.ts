import type { ContractType, ObjectType, Operation, TypeUse } from "../../model/contract-model.js";

/**
 * Parameter object of an operation
 * @param types - Declarations by stable identity
 * @param operation - Resolved operation
 * @returns The generated object declaration carrying the operation parameters, or absence
 */
export function inputOf(
  types: ReadonlyMap<string, ContractType>,
  operation: Operation,
): ObjectType | undefined {
  const type = types.get(operation.input);
  return type?.kind === "object" ? type : undefined;
}

/**
 * Media type without parameters in canonical case
 * @param mediaType - Media type with optional parameters
 * @returns Lower-case type and subtype
 */
export function mediaEssence(mediaType: string): string {
  return mediaType.split(";")[0]!.trim().toLowerCase();
}

/**
 * Raw binary media interpretation without JSON text conversion
 * @param types - Declarations by stable identity
 * @param use - Payload reference
 * @param mediaType - Explicit binding media type, absent for a bodyless result
 * @returns Whether the payload travels as the raw bytes of a non-JSON media type
 */
export function carriesRawBytes(
  types: ReadonlyMap<string, ContractType>,
  use: TypeUse | undefined,
  mediaType: string | undefined,
): boolean {
  if (use === undefined || use.nullable || mediaType === undefined) return false;
  const type = types.get(use.id);
  if (type?.kind !== "scalar" || type.scalar !== "bytes") return false;
  const essence = mediaEssence(mediaType);
  return essence !== "application/json" && !essence.endsWith("+json");
}
