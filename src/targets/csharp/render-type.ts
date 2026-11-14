import type { ContractType } from "../../model/contract-model.js";
import { renderArray } from "./array-type.js";
import type { CSharpContext } from "./context.js";
import { renderClosed } from "./literal-type.js";
import { lines } from "./naming.js";
import { renderMixedEnum } from "./mixed-enum.js";
import { objectCodec } from "./object-codec.js";
import { planFields } from "./object-plan.js";
import { objectDeclaration } from "./object-type.js";
import { renderScalar } from "./scalar-codec.js";
import { renderUnion } from "./union-type.js";

/** Contract declaration generation
 * @param c - Target context
 * @param node - Resolved declaration
 * @param needs - Nodes that provider acceptance rebuilds
 * @returns Declaration and codec
 */
export function renderType(
  c: CSharpContext,
  node: ContractType,
  needs: ReadonlySet<string>,
): string {
  switch (node.kind) {
    case "scalar":
      return renderScalar(c, node);
    case "object": {
      const plans = planFields(c, node);
      return lines(objectDeclaration(c, node, plans), objectCodec(c, node, plans));
    }
    case "array":
      return renderArray(c, node, needs.has(node.id));
    case "union":
      return renderUnion(c, node);
    case "enum":
      return c.isMixedEnum(node) ? renderMixedEnum(c, node) : renderClosed(c, node);
    case "literal":
      return renderClosed(c, node);
  }
}
