import type { HttpParameter } from "../../model/binding-model.js";
import type { Operation } from "../../model/contract-model.js";
import { inputOf } from "./acceptance.js";
import type { CSharpContext } from "./context.js";
import { requestShape, type RequestShape } from "./http-request-codec.js";
import { essenceOf, lines, pascal, pointerLiteral, quote } from "./naming.js";
import { opName } from "./outcome-codecs.js";

/** Statement that rejects the request before decoding
 * @param path - Pointer literal
 * @param rule - Rule literal
 * @returns Return statement of a failed acceptance
 */
function rejection(path: string, rule: string): string {
  return `return Result.Failed(HttpWire.Reject(${path}, ${quote(rule)}));`;
}

/** Native HTTP extraction of one placed parameter
 * @param c - Target context
 * @param operation - Operation
 * @param parameter - Placement
 * @returns Statements over the native request and route values
 */
function placedParameter(c: CSharpContext, operation: Operation, parameter: HttpParameter): string {
  const field = inputOf(c, operation).fields.find((f) => f.name === parameter.parameter)!;
  const suffix = pascal(field.name);
  const pointer = pointerLiteral(field.wireName);
  const read = {
    path: `pathValues.GetValueOrDefault(${quote(parameter.wireName)})`,
    query: `HttpWire.Query(request.RequestUri, ${quote(parameter.wireName)}, out duplicate${suffix})`,
    header: `request.Headers.TryGetValues(${quote(parameter.wireName)}, out var h${suffix}) ? h${suffix}.FirstOrDefault() : null`,
  }[parameter.location];
  const bad = rejection(pointer, "format");
  return lines(
    `bool duplicate${suffix} = false;`,
    `string? p${suffix} = ${read};`,
    parameter.location === "header" &&
      `if (request.Headers.TryGetValues(${quote(parameter.wireName)}, out var all${suffix}) && all${suffix}.Skip(1).Any()) duplicate${suffix} = true;`,
    `if (duplicate${suffix}) ${bad}`,
  );
}

/** Body bytes, text and media-type checks before the placed parameters are read
 * @param operation - Operation
 * @param shape - Body shape
 * @returns Statements that bind `rawBytes` and, for text bodies, `text`
 */
function bodyChecks(operation: Operation, shape: RequestShape): string {
  const http = operation.http!;
  return lines(
    "byte[] rawBytes = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);",
    shape !== "binary" && `if (!HttpWire.Utf8(rawBytes, out var text)) ${rejection('""', "json")}`,
    shape === "none"
      ? `if (text.Length != 0) ${rejection('""', "type")}`
      : `if (request.Content is not null && HttpWire.Essence(request.Content.Headers.ContentType?.ToString()) != ${quote(essenceOf(http.requestMediaType))}) ${rejection('""', "type")}`,
  );
}

/** Completion of the input from the mapped parameters and the body
 * @param c - Target context
 * @param operation - Operation
 * @param shape - Body shape
 * @returns Return statement that decodes the input
 */
function decodeStatement(c: CSharpContext, operation: Operation, shape: RequestShape): string {
  const input = inputOf(c, operation);
  const arguments_ = operation.http!.parameters.map((parameter) => {
    const field = input.fields.find((field) => field.name === parameter.parameter)!;
    return `p${pascal(field.name)}`;
  });
  if (shape === "parameters") arguments_.push("text");
  if (shape === "member") arguments_.push("request.Content is null ? null : text");
  if (shape === "binary")
    arguments_.push("ImmutableArray.CreateRange(rawBytes)", "request.Content is not null");
  return `return ${opName(operation, "HttpRequestCodec")}.DecodeRequest(${arguments_.join(", ")});`;
}

/** Provider-side request acceptance up to the completed input
 * @param c - Target context
 * @param operation - Operation
 * @returns Statements of the asynchronous acceptance body
 */
export function acceptRequest(c: CSharpContext, operation: Operation): string {
  const http = operation.http!;
  const shape = requestShape(c, operation);
  return lines(
    "cancellationToken.ThrowIfCancellationRequested();",
    bodyChecks(operation, shape),
    `if (request.RequestUri is null || !HttpWire.Route(${quote(http.path)}, request.RequestUri.AbsolutePath, out var pathValues)) ${rejection('""', "format")}`,
    ...http.parameters.map((parameter) => placedParameter(c, operation, parameter)),
    decodeStatement(c, operation, shape),
  );
}
