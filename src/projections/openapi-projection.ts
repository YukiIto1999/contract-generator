import type { HttpBinding } from "../model/binding-model.js";
import type { ContractModel, Operation } from "../model/contract-model.js";
import { httpDefinitions, inputFields, requestBody } from "./openapi-payload.js";
import { responseSchemas } from "./openapi-responses.js";
import { projectionLimitations, type JsonObject, type NodeIndex } from "./reference-document.js";
import { useSchema } from "./schema-projection.js";

/** Parameters placed outside the request body
 * @param operation - Public operation
 * @param http - Resolved HTTP binding
 * @param types - Complete interpreted node index
 * @returns OpenAPI parameter entries in binding order
 * @throws {@link Error} The binding places a parameter the operation does not declare
 */
function placedParameters(operation: Operation, http: HttpBinding, types: NodeIndex): JsonObject[] {
  const fields = new Map(inputFields(operation, types).map((field) => [field.name, field]));
  return http.parameters.map((parameter) => {
    const field = fields.get(parameter.parameter);
    if (field === undefined) throw new Error("Unresolved HTTP parameter: " + parameter.parameter);
    return {
      name: parameter.wireName,
      in: parameter.location,
      required: parameter.location === "path" || !field.optional,
      schema: useSchema(field.type, "http", types, httpDefinitions),
    };
  });
}

/** One published HTTP operation
 * @param operation - Public operation
 * @param http - Resolved HTTP binding
 * @param types - Complete interpreted node index
 * @returns OpenAPI operation object
 */
function operationItem(operation: Operation, http: HttpBinding, types: NodeIndex): JsonObject {
  const parameters = placedParameters(operation, http, types);
  const body = requestBody(operation, http, types);
  return {
    operationId: operation.id,
    ...(operation.description === "" ? {} : { description: operation.description }),
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(body === undefined ? {} : { requestBody: body }),
    responses: responseSchemas(operation, http, types),
  };
}

/** HTTP exploration document without complete-validation claims
 * @param model - Complete public contract
 * @param types - Complete interpreted node index
 * @returns OpenAPI reference projection
 */
export function openApiDocument(model: ContractModel, types: NodeIndex): JsonObject {
  const paths: Record<string, JsonObject> = {};
  for (const operation of model.operations) {
    const http = operation.http;
    if (http === undefined) continue;
    const route = paths[http.path] ?? {};
    route[http.method.toLowerCase()] = operationItem(operation, http, types);
    paths[http.path] = route;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: model.namespace,
      version: "0.0.0",
      description: "Reference projection only; the version is not an API release identifier",
    },
    paths,
    "x-contract-generator-purpose": "reference-only",
    "x-contract-limitations": projectionLimitations,
  };
}
