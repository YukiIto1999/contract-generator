import type { ContractModel } from "../../model/contract-model.js";
import { createContext } from "./contract-context.js";
import { operationSource } from "./contract-operations.js";
import { typeSource } from "./contract-types.js";
import { useReaderSource } from "./contract-uses.js";
import { runtimeSource } from "./runtime-source.js";

/**
 * Specialized immutable declaration and operation value emission
 * @param model - Resolved contract with target-safe declaration names
 * @returns Pure types and codec module
 */
export function renderContract(model: ContractModel): string {
  const context = createContext(model);
  const types = context.types.map((type) => typeSource(context, type));
  const operations = context.operations.map((operation) => operationSource(context, operation));
  const uses = context.uses.map((entry) => useReaderSource(context, entry));
  return [
    runtimeSource,
    context.constants.join("\n\n"),
    types.map((type) => type.declaration).join("\n\n"),
    types.map((type) => type.reader).join("\n\n"),
    uses.join("\n\n"),
    types.map((type) => type.writer).join("\n\n"),
    types.map((type) => type.entrypoint).join("\n\n"),
    operations.join("\n\n"),
    "",
  ].join("\n\n");
}
