import type { Operation, Outcome, TypeUse } from "../../model/contract-model.js";
import { node, type RustContext } from "./context.js";

/** Lowercase media-type essence without parameters
 * @param mediaType - Declared or received media type
 * @returns Type and subtype only
 */
export function essenceOf(mediaType: string): string {
  return (mediaType.split(";")[0] ?? "").trim().toLowerCase();
}

/** JSON media type: `application/json` or a `+json` structured-syntax suffix
 * @param mediaType - Declared media type
 * @returns Whether a body of this type is a JSON document
 */
export function jsonMedia(mediaType: string): boolean {
  const essence = essenceOf(mediaType);
  return essence === "application/json" || essence.endsWith("+json");
}

/** Whether a bytes value travels as the raw body rather than as a JSON string
 * @param ctx - Resolved rendering context
 * @param use - Payload use, absent for a void result
 * @param mediaType - Media type of the body, absent for a bodyless result
 * @returns True for a nonnullable bytes payload under a media type that is not JSON
 */
export function rawBytes(
  ctx: RustContext,
  use: TypeUse | undefined,
  mediaType: string | undefined,
): boolean {
  if (use === undefined || use.nullable || mediaType === undefined || jsonMedia(mediaType))
    return false;
  const type = node(ctx, use.id);
  return type.kind === "scalar" && type.scalar === "bytes";
}

/** Whether an outcome payload is the raw HTTP response body
 * @param ctx - Resolved rendering context
 * @param operation - Canonical operation
 * @param outcome - Canonical outcome
 * @returns True when the HTTP mapping of the outcome carries raw bytes
 */
export function rawOutcome(ctx: RustContext, operation: Operation, outcome: Outcome): boolean {
  const mapping = operation.http?.results.find((result) => result.outcome === outcome.name);
  return rawBytes(ctx, outcome.type, mapping?.mediaType);
}
