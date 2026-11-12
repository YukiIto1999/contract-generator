import type { ContractType } from "../../model/contract-model.js";
import { arrayParts, objectParts, unionParts } from "./contract-composites.js";
import type { ContractContext } from "./contract-context.js";
import { declarationSource } from "./contract-declarations.js";
import { literalParts } from "./contract-literals.js";
import { scalarParts } from "./contract-scalars.js";
import type { Declared, Parts } from "./contract-shapes.js";
import { tsdoc } from "./source-text.js";

/** Every emitted piece of one declaration */
export interface TypeSource extends Parts {
  /** Exported public type alias */
  readonly declaration: string;
  /** Exported validated codec of the same name */
  readonly entrypoint: string;
}

/**
 * Specialized reader and writer of a declaration
 * @param context - Generation state
 * @param type - Declaration
 * @param declared - Generated names
 * @returns Reader and writer for the declaration kind
 */
function partsOf(context: ContractContext, type: ContractType, declared: Declared): Parts {
  switch (type.kind) {
    case "scalar":
      return scalarParts(context, type, declared);
    case "object":
      return objectParts(context, type, declared);
    case "array":
      return arrayParts(context, type, declared);
    case "union":
      return unionParts(context, type, declared);
    case "literal":
    case "enum":
      return literalParts(context, type, declared);
  }
}

/**
 * Complete generated text of one declaration
 * @param context - Generation state
 * @param type - Declaration
 * @returns Type alias, reader, writer and codec entrypoint
 */
export function typeSource(context: ContractContext, type: ContractType): TypeSource {
  const declared: Declared = {
    name: type.name,
    reader: context.readers.get(type.id)!,
    writer: context.writers.get(type.id)!,
  };
  const entrypoint = [
    tsdoc(`Validated ${type.name} construction and codec without provider defaults`),
    `export const ${type.name}: Codec<${type.name}> = codec(${declared.reader}, ${declared.writer});`,
  ].join("\n");
  return {
    declaration: declarationSource(context, type),
    ...partsOf(context, type, declared),
    entrypoint,
  };
}
