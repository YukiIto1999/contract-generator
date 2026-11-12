import type { ContractModel, ContractType, Operation } from "../../model/contract-model.js";
import { createContext } from "./context.js";
import { buildable } from "./defaults.js";
import type { Report } from "./issue-report.js";
import { snake, stem } from "./naming.js";
import { literalJson } from "./storage.js";

/** HTTP methods with constants in both the client and the native request types */
const methods = new Set([
  "GET",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "HEAD",
  "OPTIONS",
  "TRACE",
  "CONNECT",
]);

/** Generated operation type and function names that collide with canonical declarations
 * @param model - Complete normalized contract
 * @param report - Issue sink
 */
export function checkOperationNames(model: ContractModel, report: Report): void {
  const names = new Set(model.types.map((type) => type.name));
  const nodes = new Map(model.types.map((type) => [type.id, type]));
  const functions = new Set(
    model.types.flatMap((type) =>
      ["decode", "encode"].flatMap((verb) => [
        `${verb}_${snake(type.name)}`,
        `${verb}_${snake(type.name)}_value`,
      ]),
    ),
  );
  for (const operation of model.operations) {
    const input = nodes.get(operation.input);
    const accepted =
      input?.kind === "object" &&
      input.fields.some((field) => field.optional && field.default !== undefined);
    for (const name of [
      `${stem(operation)}Success`,
      `${stem(operation)}Rejection`,
      ...(accepted ? [`${stem(operation)}Accepted`] : []),
    ]) {
      if (names.has(name))
        report(
          operation.origin,
          operation.id,
          `Rust operation declaration ${name} collides with another generated declaration`,
        );
      names.add(name);
    }
    for (const outcome of operation.outcomes)
      for (const verb of ["decode", "encode"])
        if (functions.has(`${verb}_${snake(operation.name)}_${snake(outcome.name)}`))
          report(
            outcome.origin,
            operation.id,
            `Rust outcome function ${verb}_${snake(operation.name)}_${snake(outcome.name)} collides with a canonical type codec`,
          );
    if (input?.kind !== "object")
      report(operation.origin, operation.id, "Operation input must resolve to a canonical object");
  }
}

/** HTTP bindings whose method, headers or parameter spellings Rust cannot send faithfully
 * @param operation - Canonical operation
 * @param nodes - Declarations by identity
 * @param report - Issue sink
 */
export function checkHttp(
  operation: Operation,
  nodes: ReadonlyMap<string, ContractType>,
  report: Report,
): void {
  const http = operation.http;
  if (!http) return;
  const token = /^[a-z0-9!#$%&'*+.^_`|~-]+$/;
  const visible = /^[\t\x20-\x7e\u0080-\uffff]*$/;
  if (!methods.has(http.method))
    report(http.origin, operation.id, `HTTP method ${http.method} has no Rust request constant`);
  if (!visible.test(http.requestMediaType))
    report(http.origin, operation.id, "The request media type is not a valid header value");
  for (const mapping of http.parameters) {
    if (mapping.location === "header" && !token.test(mapping.wireName.toLowerCase()))
      report(mapping.origin, operation.id, "The header parameter name is not an HTTP token");
    const field = nodes.get(operation.input);
    const member =
      field?.kind === "object"
        ? field.fields.find((candidate) => candidate.name === mapping.parameter)
        : undefined;
    const type = member === undefined ? undefined : nodes.get(member.type.id);
    if (
      type?.kind === "enum" &&
      new Set(
        type.members.map((entry) =>
          entry.value.kind === "string" ? entry.value.value : literalJson(entry.value),
        ),
      ).size !== type.members.length
    )
      report(
        mapping.origin,
        operation.id,
        "Enum members have an ambiguous HTTP parameter spelling",
      );
  }
  for (const result of http.results) {
    const headers = [
      ...Object.entries(result.headers),
      ...(result.mediaType === undefined ? [] : [["content-type", result.mediaType] as const]),
    ];
    if (headers.some(([name, value]) => !token.test(name) || !visible.test(value)))
      report(
        result.origin,
        operation.id,
        "A declared response header is not valid in a Rust response",
      );
  }
}

/** Provider defaults that Rust storage cannot hold
 * @param model - Complete normalized contract
 * @param report - Issue sink
 */
export function checkDefaults(model: ContractModel, report: Report): void {
  const ctx = createContext(model, "check");
  for (const type of model.types)
    for (const field of type.kind === "object" ? type.fields : [])
      if (!buildable(ctx, field))
        report(
          field.origin,
          `${type.id}.${field.name}`,
          "The provider default cannot be built into the Rust storage of its field without a run-time failure",
        );
}
