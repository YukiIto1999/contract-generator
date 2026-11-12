import type { ContractModel, GeneratedFile } from "../model/contract-model.js";
import { markdownReference } from "./markdown-reference.js";
import { openApiDocument } from "./openapi-projection.js";
import { serialize } from "./reference-document.js";
import { schemaDocument } from "./schema-projection.js";

/** Reference artifacts derived from the same private contract interpretation
 * @param model - Complete validated contract
 * @returns Reference-only JSON Schema and OpenAPI projections with reader documentation
 * @throws {@link Error} The model refers to a node, outcome or parameter that it does not declare
 */
export function renderProjections(model: ContractModel): readonly GeneratedFile[] {
  const types = new Map(model.types.map((node) => [node.id, node]));
  const files: GeneratedFile[] = [
    { path: "schemas/http.schema.json", content: serialize(schemaDocument(model, "http", types)) },
    { path: "schemas/ipc.schema.json", content: serialize(schemaDocument(model, "ipc", types)) },
    { path: "docs/reference.md", content: markdownReference(model, types) },
  ];
  if (model.operations.some((operation) => operation.http !== undefined))
    files.push({ path: "http/openapi.json", content: serialize(openApiDocument(model, types)) });
  return files;
}
