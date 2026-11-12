import type { HttpParameter } from "../../model/binding-model.js";
import type { Field, Operation } from "../../model/contract-model.js";
import { inputOf } from "./acceptance.js";
import type { CSharpContext } from "./context.js";
import { requestShape, type RequestShape } from "./http-request-codec.js";
import { essenceOf, lines, pascal, pointerLiteral, quote } from "./naming.js";
import { opName } from "./outcome-codecs.js";

/** Scalar meanings whose HTTP parameter text is a JSON string whatever the encoding */
const textualScalars: Readonly<Record<string, true>> = {
  string: true,
  bytes: true,
  offsetDateTime: true,
  utcDateTime: true,
  plainDate: true,
  plainTime: true,
  duration: true,
};

/** Whether the HTTP text of a parameter is a JSON string token
 * @param c - Target context
 * @param field - Parameter field
 * @returns String token marker
 */
function isTextParameter(c: CSharpContext, field: Field): boolean {
  const node = c.node(field.type.id);
  switch (node.kind) {
    case "scalar":
      return (
        textualScalars[node.scalar] === true ||
        (field.type.encodings?.http ?? node.encodings.http) === "string"
      );
    case "literal":
      return node.value.kind === "string";
    case "enum":
      return node.members[0]?.value.kind === "string";
    case "array":
    case "object":
    case "union":
      return false;
  }
}

/** Statement that rejects the request before decoding
 * @param c - Target context
 * @param operation - Operation
 * @param path - Pointer literal
 * @param rule - Rule literal
 * @returns Return statement of a failed acceptance
 */
function rejection(c: CSharpContext, operation: Operation, path: string, rule: string): string {
  const t = c.type(inputOf(c, operation).id);
  return `return new Result<Accepted<${t}>, ContractFailure>.Failed(HttpWire.Reject(${path}, ${quote(rule)}));`;
}

/** Placement extraction of one parameter into the mapped JSON object
 * @param c - Target context
 * @param operation - Operation
 * @param parameter - Placement
 * @returns Statements over `writer` and `pathValues`
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
  const bad = rejection(c, operation, pointer, "format");
  return lines(
    `bool duplicate${suffix} = false;`,
    `string? p${suffix} = ${read};`,
    parameter.location === "header" &&
      `if (request.Headers.TryGetValues(${quote(parameter.wireName)}, out var all${suffix}) && all${suffix}.Skip(1).Any()) duplicate${suffix} = true;`,
    `if (duplicate${suffix}) ${bad}`,
    `if (p${suffix} is not null) { writer.WritePropertyName(${quote(field.wireName)}); string token = HttpWire.Token(p${suffix}, ${isTextParameter(c, field)}); try { using var parameter = JsonDocument.Parse(token); parameter.RootElement.WriteTo(writer); } catch (JsonException) { ${bad} } }`,
  );
}

/** Body bytes, text and media-type checks before the placed parameters are read
 * @param c - Target context
 * @param operation - Operation
 * @param shape - Body shape
 * @returns Statements that bind `rawBytes` and, for text bodies, `text`
 */
function bodyChecks(c: CSharpContext, operation: Operation, shape: RequestShape): string {
  const http = operation.http!;
  return lines(
    "byte[] rawBytes = request.Content is null ? [] : await request.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);",
    shape !== "binary" &&
      `if (!HttpWire.Utf8(rawBytes, out var text)) ${rejection(c, operation, '""', "json")}`,
    shape === "none"
      ? `if (text.Length != 0) ${rejection(c, operation, '""', "type")}`
      : `if (request.Content is not null && HttpWire.Essence(request.Content.Headers.ContentType?.ToString()) != ${quote(essenceOf(http.requestMediaType))}) ${rejection(c, operation, '""', "type")}`,
  );
}

/** Completion of the input from the mapped parameters and the body
 * @param c - Target context
 * @param operation - Operation
 * @param shape - Body shape
 * @returns Return statement that decodes the input
 */
function decodeStatement(c: CSharpContext, operation: Operation, shape: RequestShape): string {
  const mapped = "Encoding.UTF8.GetString(stream.ToArray())";
  const codec = opName(operation, "HttpRequestCodec");
  switch (shape) {
    case "none":
      return `return ${c.codec(operation.input)}.Decode(${mapped}, "http");`;
    case "parameters":
      return `return ${codec}.Decode(${mapped}, text);`;
    case "member":
      return `return ${codec}.Decode(${mapped}, request.Content is null ? null : text);`;
    case "binary":
      return `return ${codec}.Decode(${mapped}, ImmutableArray.CreateRange(rawBytes), request.Content is not null);`;
  }
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
    bodyChecks(c, operation, shape),
    `if (request.RequestUri is null || !HttpWire.Route(${quote(http.path)}, request.RequestUri.AbsolutePath, out var pathValues)) ${rejection(c, operation, '""', "format")}`,
    "using var stream = new MemoryStream();",
    "using (var writer = new Utf8JsonWriter(stream)) {",
    "writer.WriteStartObject();",
    ...http.parameters.map((parameter) => placedParameter(c, operation, parameter)),
    "writer.WriteEndObject();",
    "}",
    decodeStatement(c, operation, shape),
  );
}
