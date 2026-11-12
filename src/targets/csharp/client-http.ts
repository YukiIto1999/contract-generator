import type { HttpParameter, HttpResult } from "../../model/binding-model.js";
import type { ObjectType, Operation } from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { inputOf } from "./acceptance.js";
import { binaryOutcome, communicationReturn, decodeOutcome, mismatch } from "./client-outcome.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { binaryBody, requestShape, type RequestShape } from "./http-request-codec.js";
import { essenceOf, isJsonMediaType, lines, name, pascal, quote } from "./naming.js";
import { opName } from "./outcome-codecs.js";
import { requireValue } from "./result-helpers.js";

/** Content type assignment of the request body
 * @param mediaType - Declared request media type
 * @returns Statement over `request`
 */
function contentType(mediaType: string): string {
  return `request.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(${quote(mediaType)});`;
}

/** Placement of one parameter that travels outside the body
 * @param input - Operation input object
 * @param parameter - Placement
 * @param refusal - Return statement that reports a parameter text without an HTTP wire form
 * @returns Statements that place the parameter text
 */
function parameterStatement(input: ObjectType, parameter: HttpParameter, refusal: string): string {
  const field = input.fields.find((candidate) => candidate.name === parameter.parameter)!;
  const variable = `p${pascal(field.name)}`;
  const place = {
    path: `if (!HttpWire.PathSegment(text, out var segment)) ${refusal} path = path.Replace(${quote("{" + parameter.wireName + "}")}, segment, StringComparison.Ordinal);`,
    query: `query.Add(${quote(parameter.wireName + "=")} + Uri.EscapeDataString(text));`,
    header: `if (!HttpWire.HeaderText(text)) ${refusal} if (!request.Headers.TryAddWithoutValidation(${quote(parameter.wireName)}, text)) throw new InvalidOperationException("Invalid request header mapping");`,
  }[parameter.location];
  return lines(
    `if (inputDocument.RootElement.TryGetProperty(${quote(field.wireName)}, out var ${variable})) {`,
    `string text = HttpWire.Scalar(${variable}.GetRawText());`,
    place,
    "}",
  );
}

/** Body of a request whose single parameter is raw bytes
 * @param c - Target context
 * @param operation - Operation
 * @param input - Operation input object
 * @returns Statements that assign the content
 */
function binaryContent(c: CSharpContext, operation: Operation, input: ObjectType): string {
  const field = binaryBody(c, operation)!;
  const property = `input.${c.property(input.id, field.name)}`;
  const value = field.optional ? `${property}.Value` : property;
  const node = c.node(field.type.id);
  const bytes = node.kind === "scalar" && node.role !== null ? `${value}.Value` : value;
  return lines(
    field.optional && `if (${property}.IsPresent) {`,
    `if (${c.codec(field.type.id)}.Validate(${value}) is Result<Accepted<${c.type(field.type.id)}>, ContractFailure>.Failed) throw new InvalidOperationException("Invalid byte body before wire output");`,
    `request.Content = new ReadOnlyMemoryContent(${bytes}.AsMemory());`,
    contentType(operation.http!.requestMediaType),
    field.optional && "}",
  );
}

/** Request body statements by body shape
 * @param c - Target context
 * @param operation - Operation
 * @param shape - Body shape
 * @returns Statements that assign `request.Content`, or nothing for a bodyless request
 */
function requestBody(c: CSharpContext, operation: Operation, shape: RequestShape): string {
  const http = operation.http!;
  const input = inputOf(c, operation);
  const mediaType = http.requestMediaType;
  switch (shape) {
    case "none":
      return "";
    case "binary":
      return binaryContent(c, operation, input);
    case "member": {
      const member = input.fields.find(
        (f) => http.body.kind === "parameter" && f.name === http.body.parameter,
      )!;
      return lines(
        `if (inputDocument.RootElement.TryGetProperty(${quote(member.wireName)}, out var body)) {`,
        "request.Content = new StringContent(body.GetRawText(), Encoding.UTF8);",
        contentType(mediaType),
        "}",
      );
    }
    case "parameters": {
      const placed = new Set(http.parameters.map((parameter) => parameter.parameter));
      const names = input.fields
        .filter((f) => !placed.has(f.name))
        .map((f) => `p.Name == ${quote(f.wireName)}`);
      return lines(
        "using (var stream = new MemoryStream()) {",
        `using (var writer = new Utf8JsonWriter(stream)) { writer.WriteStartObject(); foreach (var p in inputDocument.RootElement.EnumerateObject()) { if (${names.join(" || ") || "false"}) p.WriteTo(writer); } writer.WriteEndObject(); }`,
        "request.Content = new ByteArrayContent(stream.ToArray());",
        contentType(mediaType),
        "}",
      );
    }
  }
}

/** Selector of one declared result before its body is read
 * @param mapping - Declared result
 * @returns Boolean expression over `status` and `response`
 */
function selector(mapping: HttpResult): string {
  const media =
    mapping.mediaType === undefined
      ? "response.Content.Headers.ContentType is null"
      : `HttpWire.Essence(response.Content.Headers.ContentType?.ToString()) == ${quote(essenceOf(mapping.mediaType))}`;
  const headers = Object.entries(mapping.headers)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, value]) => `HttpWire.Header(response, ${quote(key)}, ${quote(value)})`);
  return [`status == ${mapping.status}`, media, ...headers].join(" && ");
}

/** Body completion of the selected result
 * @param c - Target context
 * @param operation - Operation
 * @param mapping - Selected result
 * @returns Statements that return the typed result or leave the block for a bodyless mismatch
 */
function resultBody(c: CSharpContext, operation: Operation, mapping: HttpResult): string {
  const outcome = operation.outcomes.find((o) => o.name === mapping.outcome)!;
  if (!outcome.type)
    return `if (bytes.Length == 0) { ${decodeOutcome(operation, outcome, '""', "http", true)} }`;
  const node = c.node(outcome.type.id);
  if (node.kind === "scalar" && node.scalar === "bytes" && !isJsonMediaType(mapping.mediaType))
    return binaryOutcome(c, operation, outcome);
  return lines(
    `if (!HttpWire.Utf8(bytes, out var bodyText)) { ${mismatch(operation, "gateway-body-mismatch", "Invalid response UTF-8")} }`,
    decodeOutcome(operation, outcome, "bodyText", "http", true),
  );
}

/** Result selection by status, media type and selector headers, then body decoding
 * @param c - Target context
 * @param operation - Operation
 * @returns One guarded block per declared result
 */
function resultBlocks(c: CSharpContext, operation: Operation): string {
  return lines(
    ...operation.http!.results.map((mapping) =>
      lines(
        `if (${selector(mapping)}) {`,
        "byte[] bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken).ConfigureAwait(false);",
        resultBody(c, operation, mapping),
        "}",
      ),
    ),
  );
}

/** Client result-to-effect flattening
 * @param operation - Operation
 * @returns Bind callback
 */
export function flatten(operation: Operation): string {
  const success = opName(operation, "Success");
  const result = `Result<${success}, ${opName(operation, "Failure")}>`;
  return `.Bind(result => result is ${result}.Succeeded succeeded ? fx.Succeed(succeeded.Value) : fx.Fail<${success}>(((${result}.Failed)result).Failure))`;
}

/** Request construction before the exchange
 * @param c - Target context
 * @param operation - Operation
 * @param shape - Body shape
 * @returns Statements that fill `request`
 */
function requestStatements(c: CSharpContext, operation: Operation, shape: RequestShape): string {
  const http = operation.http!;
  const input = inputOf(c, operation);
  const encoded =
    shape === "binary"
      ? `${opName(operation, "HttpRequestCodec")}.EncodeParameters(input)`
      : `${c.codec(input.id)}.Encode(input, "http")`;
  const refusal = communicationReturn(operation, "request-wire-form");
  return lines(
    requireValue("string", encoded, "inputJson"),
    `string path = ${quote(http.path)}; var query = new List<string>();`,
    `using var request = new HttpRequestMessage(); request.Method = new HttpMethod(${quote(http.method)});`,
    "using var inputDocument = JsonDocument.Parse(inputJson);",
    ...http.parameters.map((parameter) => parameterStatement(input, parameter, refusal)),
    `var target = new Uri(requirements.ServiceOrigin, path + (query.Count == 0 ? "" : "?" + string.Join("&", query)));`,
    `if (!HttpWire.SameOrigin(requirements.ServiceOrigin, target)) ${refusal}`,
    "request.RequestUri = target;",
    "request.Options.Set(DeadlineOption, deadline);",
    requestBody(c, operation, shape),
  );
}

/** HTTP native request and selected-result acceptance
 * @param c - Target context
 * @param operation - Operation
 * @returns Consumer method
 */
export function renderHttpClient(c: CSharpContext, operation: Operation): string {
  const success = opName(operation, "Success");
  const failure = opName(operation, "Failure");
  const result = `Result<${success}, ${failure}>`;
  return lines(
    doc(
      "Native HTTP operation effect",
      ["input", "deadline"],
      "Selected success or typed failure",
      {
        throws: [["InvalidOperationException", "A request or response that breaks the contract"]],
      },
    ),
    `public static Effect<IClientRequirements, ${failure}, ${success}> ${name(pascal(operation.name) + "Http")}(${c.type(operation.input)} input, DateTimeOffset? deadline) {`,
    `var fx = new EffectContext<IClientRequirements, ${failure}>();`,
    `return fx.Try<${result}>(async (requirements, cancellationToken) => {`,
    requestStatements(c, operation, requestShape(c, operation)),
    "cancellationToken.ThrowIfCancellationRequested();",
    "try {",
    "using var response = await requirements.HttpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken).ConfigureAwait(false);",
    "int status = (int)response.StatusCode;",
    "bool gateway = status is 502 or 503 or 504;",
    resultBlocks(c, operation),
    `if (gateway) return new ${result}.Failed(new ${failure}.Communication(new("gateway-selector-mismatch")));`,
    `throw new InvalidOperationException("Undeclared HTTP response selector");`,
    `} catch (OperationCanceledException exception) when (!cancellationToken.IsCancellationRequested) { throw new HttpRequestException("Unattributed native HTTP cancellation", exception); }`,
    `}, exception => exception is HttpRequestException or IOException ? new ${failure}.Communication(new("http-communication")) : throw exception)${flatten(operation)};`,
    "}",
  );
}
