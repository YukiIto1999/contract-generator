import type { HttpBinding } from "../model/binding-model.js";
import type { Field, Operation, TypeUse } from "../model/contract-model.js";
import { requiredNode, type JsonObject, type NodeIndex } from "./reference-document.js";
import { objectSchema, useSchema } from "./schema-projection.js";

/** Definition location of the HTTP schema document as seen from the OpenAPI document */
export const httpDefinitions = "../schemas/http.schema.json#/$defs/";

/** JSON media type membership
 * @param mediaType - Declared media type with optional parameters
 * @returns Whether the body is a JSON text rather than raw bytes
 */
export function isJsonMediaType(mediaType: string): boolean {
  const essence = mediaType.split(";", 1)[0]?.trim().toLowerCase();
  return essence === "application/json" || essence?.endsWith("+json") === true;
}

/** Canonical operation parameter lookup
 * @param operation - Public operation
 * @param types - Complete interpreted node index
 * @returns Operation parameter object fields
 * @throws {@link Error} The operation input is not an object node
 */
export function inputFields(operation: Operation, types: NodeIndex): readonly Field[] {
  const input = requiredNode(types, operation.input);
  if (input.kind !== "object") throw new Error("An operation input must be an object");
  return input.fields;
}

/** Body schema for a payload declared with a media type
 * @param use - Resolved payload type use
 * @param mediaType - Declared body media type
 * @param types - Complete interpreted node index
 * @returns Raw binary schema for bytes under a non-JSON media type, otherwise the JSON value schema
 */
export function payloadSchema(use: TypeUse, mediaType: string, types: NodeIndex): JsonObject {
  const node = requiredNode(types, use.id);
  if (node.kind === "scalar" && node.scalar === "bytes" && !isJsonMediaType(mediaType))
    return { type: "string", format: "binary" };
  return useSchema(use, "http", types, httpDefinitions);
}

/** Request body that is exactly one operation parameter
 * @param operation - Public operation
 * @param http - Resolved HTTP binding
 * @param parameter - Canonical name of the body parameter
 * @param types - Complete interpreted node index
 * @returns Request body reference for the parameter
 * @throws {@link Error} The binding names a body parameter the operation does not declare
 */
function parameterBody(
  operation: Operation,
  http: HttpBinding,
  parameter: string,
  types: NodeIndex,
): JsonObject {
  const field = inputFields(operation, types).find((candidate) => candidate.name === parameter);
  if (field === undefined) throw new Error("Unresolved body parameter: " + parameter);
  return {
    required: !field.optional,
    content: {
      [http.requestMediaType]: { schema: payloadSchema(field.type, http.requestMediaType, types) },
    },
  };
}

/** Request body made of every parameter that is not placed elsewhere
 * @param operation - Public operation
 * @param http - Resolved HTTP binding
 * @param types - Complete interpreted node index
 * @returns Request body reference for the remaining parameters
 */
function objectBody(operation: Operation, http: HttpBinding, types: NodeIndex): JsonObject {
  const placed = new Set(http.parameters.map((parameter) => parameter.parameter));
  const members = inputFields(operation, types).filter((field) => !placed.has(field.name));
  return {
    required: true,
    content: {
      [http.requestMediaType]: {
        schema: objectSchema(members, "http", types, httpDefinitions),
      },
    },
  };
}

/** OpenAPI body projection for the declared HTTP placement
 * @param operation - Public operation
 * @param http - Resolved HTTP binding
 * @param types - Complete interpreted node index
 * @returns Request body reference or absence of a body
 */
export function requestBody(
  operation: Operation,
  http: HttpBinding,
  types: NodeIndex,
): JsonObject | undefined {
  switch (http.body.kind) {
    case "none":
      return undefined;
    case "parameter":
      return parameterBody(operation, http, http.body.parameter, types);
    case "parameters":
      return objectBody(operation, http, types);
  }
}
