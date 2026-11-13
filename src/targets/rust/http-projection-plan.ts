import type { Field, ObjectType, Operation } from "../../model/contract-model.js";
import { snake, stem } from "./naming.js";

/** Resolved HTTP request projection choices */
export interface HttpProjectionPlan {
  /** Canonical HTTP binding */
  readonly http: NonNullable<Operation["http"]>;
  /** Canonical input object */
  readonly input: ObjectType;
  /** Public function name prefix */
  readonly op: string;
  /** Public request type prefix */
  readonly name: string;
  /** Input fields with nonbody placements */
  readonly fields: readonly Field[];
  /** Input field selected as the whole body */
  readonly bodyField: Field | undefined;
  /** Unencoded binary body field */
  readonly raw: Field | undefined;
  /** Input fields decoded through the private document */
  readonly otherFields: readonly Field[];
  /** Input binding requirement for request encoding */
  readonly usesInput: boolean;
  /** Wire binding requirement for request encoding */
  readonly usesEncoding: boolean;
}

/** Parameter and body membership for an HTTP request projection
 * @param operation - Canonical operation
 * @param input - Resolved input object
 * @param raw - Unencoded binary body field
 * @returns Projection choices when an HTTP binding exists
 */
export function httpProjectionPlan(
  operation: Operation,
  input: ObjectType,
  raw: Field | undefined,
): HttpProjectionPlan | undefined {
  const http = operation.http;
  if (http === undefined) return undefined;
  const bodyField =
    http.body.kind === "parameter"
      ? input.fields.find(
          (field) => http.body.kind === "parameter" && field.name === http.body.parameter,
        )
      : undefined;
  const fields = http.parameters.flatMap((mapping) => {
    const field = input.fields.find((candidate) => candidate.name === mapping.parameter);
    return field === undefined ? [] : [field];
  });
  const usesInput =
    fields.length > 0 ||
    raw !== undefined ||
    bodyField !== undefined ||
    (http.body.kind === "parameters" && input.fields.length > 0);
  const usesEncoding =
    fields.length > 0 ||
    (raw === undefined &&
      (bodyField !== undefined || (http.body.kind === "parameters" && input.fields.length > 0)));
  return {
    http,
    input,
    op: snake(operation.name),
    name: stem(operation),
    fields,
    bodyField,
    raw,
    otherFields: input.fields.filter((field) => field !== raw),
    usesInput,
    usesEncoding,
  };
}
