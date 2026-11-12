import type { HttpBinding, HttpResult } from "../model/binding-model.js";
import type { Operation, Outcome } from "../model/contract-model.js";
import { payloadSchema } from "./openapi-payload.js";
import type { JsonObject, NodeIndex } from "./reference-document.js";

/** Declared outcome of a response mapping
 * @param operation - Public operation
 * @param name - Canonical outcome name of the mapping
 * @returns Outcome declared by the operation
 * @throws {@link Error} The mapping names an outcome the operation does not declare
 */
function requiredOutcome(operation: Operation, name: string): Outcome {
  const outcome = operation.outcomes.find((candidate) => candidate.name === name);
  if (outcome === undefined) throw new Error("Unresolved response outcome: " + name);
  return outcome;
}

/** Explicit selector annotation for one mapping
 * @param outcome - Declared outcome
 * @param mapping - Response mapping selecting the outcome
 * @returns Outcome correlation kept as an annotation rather than a payload-based claim
 */
function outcomeAnnotation(outcome: Outcome, mapping: HttpResult): JsonObject {
  return {
    name: outcome.name,
    channel: outcome.rejection ? "rejection" : "success",
    mediaType: mapping.mediaType ?? null,
    selectors: mapping.headers,
  };
}

/** Media type content of one status
 * @param schemas - Payload schemas grouped by media type
 * @returns Content catalogue with alternatives for a shared media type
 */
function contentOf(schemas: ReadonlyMap<string, readonly JsonObject[]>): JsonObject {
  return Object.fromEntries(
    [...schemas].map(([name, group]) => [
      name,
      { schema: group.length === 1 ? group[0] : { anyOf: group } },
    ]),
  );
}

/** One status with every outcome that shares it
 * @param operation - Public operation
 * @param mappings - Response mappings that declare the status
 * @param types - Complete interpreted node index
 * @returns Status response with its explicit outcome annotations
 */
function statusResponse(
  operation: Operation,
  mappings: readonly HttpResult[],
  types: NodeIndex,
): JsonObject {
  const schemas = new Map<string, JsonObject[]>();
  const outcomes: JsonObject[] = [];
  for (const mapping of mappings) {
    const outcome = requiredOutcome(operation, mapping.outcome);
    outcomes.push(outcomeAnnotation(outcome, mapping));
    if (outcome.type === undefined || mapping.mediaType === undefined) continue;
    const schema = payloadSchema(outcome.type, mapping.mediaType, types);
    const group = schemas.get(mapping.mediaType);
    if (group === undefined) schemas.set(mapping.mediaType, [schema]);
    else group.push(schema);
  }
  return {
    description: mappings.map((mapping) => mapping.outcome).join(" or "),
    ...(schemas.size === 0 ? {} : { content: contentOf(schemas) }),
    "x-contract-outcomes": outcomes,
  };
}

/** OpenAPI response catalogue with correlations retained as explicit annotations
 * @param operation - Public operation
 * @param http - Resolved HTTP binding
 * @param types - Complete interpreted node index
 * @returns Exact status groups without payload-based classification claims
 */
export function responseSchemas(
  operation: Operation,
  http: HttpBinding,
  types: NodeIndex,
): JsonObject {
  const responses: JsonObject = {};
  const statuses = [...new Set(http.results.map((result) => result.status))].sort(
    (left, right) => left - right,
  );
  for (const status of statuses) {
    const mappings = http.results.filter((result) => result.status === status);
    responses[String(status)] = statusResponse(operation, mappings, types);
  }
  return responses;
}
