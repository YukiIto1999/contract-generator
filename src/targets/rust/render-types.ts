import type { ContractType } from "../../model/contract-model.js";
import type { RustContext } from "./context.js";
import { renderAcceptance } from "./render-acceptance.js";
import { renderArray } from "./render-array.js";
import { renderClosed } from "./render-closed.js";
import { renderObject } from "./render-object.js";
import { renderScalar } from "./render-scalar.js";
import { renderUnion } from "./render-union.js";
import { renderDecode } from "./render-decode.js";
import { renderEncode } from "./render-encode.js";
import { renderOwnership } from "./render-ownership.js";
import { typesPreamble, typesSupport } from "./runtime.js";
import { reachable } from "./support.js";

/** Rust declaration and codecs of one canonical type
 * @param ctx - Resolved generation context
 * @param type - Canonical declaration
 * @returns Rust source of the declaration
 */
function renderType(ctx: RustContext, type: ContractType): string {
  switch (type.kind) {
    case "scalar":
      return renderScalar(ctx, type);
    case "object":
      return renderObject(ctx, type);
    case "array":
      return renderArray(ctx, type);
    case "union":
      return renderUnion(ctx, type);
    case "enum":
    case "literal":
      return renderClosed(type);
  }
}

/** Generated declarations of the pure Rust types dependency unit
 * @param ctx - Resolved generation context
 * @returns Rust declarations that still require the codec vocabulary
 */
export function renderTypes(ctx: RustContext): string {
  return (
    ctx.model.types.map((type) => renderType(ctx, type)).join("\n") +
    renderAcceptance(ctx) +
    renderOwnership(ctx) +
    renderDecode(ctx) +
    renderEncode(ctx)
  );
}

/** Complete types crate source retaining only reachable codec support
 * @param declarations - Every generated declaration of the unit
 * @returns Deterministic Rust source without unused helpers
 */
export function assembleTypes(declarations: string): string {
  return typesPreamble + reachable(declarations, typesSupport) + declarations;
}
