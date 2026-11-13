import type { Field, Operation } from "../../model/contract-model.js";
import { inputOf } from "./acceptance.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import type { RequestShape } from "./http-request-codec.js";
import { lines, quote } from "./naming.js";

/** Operation parameter positions in the native transport seam */
interface TransportParameter {
  /** Contract field carried by the parameter */
  readonly field: Field;
  /** Generated projection property */
  readonly property: string;
  /** Generated acceptance argument */
  readonly argument: string;
}

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

/** Native HTTP projection representation
 * @param parameters - Operation parameter positions
 * @returns Documented projection record
 */
function projectionType(parameters: readonly TransportParameter[]): string {
  const arguments_ = parameters.map(({ property }) => `string? ${property}`);
  return lines(
    doc("Operation-specific HTTP request text projection", [
      ...parameters.map(
        ({ property, field }) =>
          [property, `HTTP text of ${field.name} or null when absent`] as const,
      ),
      ["Body", "JSON request body or null when absent or transported as native bytes"],
    ]),
    `public sealed record Projection(${[...arguments_, "string? Body"].join(", ")});`,
  );
}

/** JSON body projection from an accepted operation input
 * @param c - Target context
 * @param operation - HTTP operation
 * @param shape - Native body representation
 * @param parameters - Operation parameter positions
 * @returns Statements that bind the optional JSON body
 */
function projectBody(
  c: CSharpContext,
  operation: Operation,
  shape: RequestShape,
  parameters: readonly TransportParameter[],
): string {
  const body = operation.http!.body;
  if (shape === "member" && body.kind === "parameter") {
    const member = inputOf(c, operation).fields.find((field) => field.name === body.parameter)!;
    return `if (root.TryGetProperty(${quote(member.wireName)}, out var member)) body = member.GetRawText();`;
  }
  if (shape !== "parameters") return "";
  return lines(
    "using var stream = new MemoryStream();",
    "using (var writer = new Utf8JsonWriter(stream, Wire.WriterOptions)) {",
    "writer.WriteStartObject();",
    "foreach (var property in root.EnumerateObject()) {",
    `if (${parameters.map(({ field }) => `property.Name != ${quote(field.wireName)}`).join(" && ") || "true"}) { writer.WritePropertyName(property.Name); writer.WriteRawValue(property.Value.GetRawText(), skipInputValidation: true); }`,
    "}",
    "writer.WriteEndObject();",
    "}",
    "body = Encoding.UTF8.GetString(stream.GetBuffer(), 0, checked((int)stream.Length));",
  );
}

/** Native HTTP projection of an accepted operation input
 * @param c - Target context
 * @param operation - HTTP operation
 * @param shape - Native body representation
 * @param parameters - Operation parameter positions
 * @returns Typed projection method
 */
function projectMethod(
  c: CSharpContext,
  operation: Operation,
  shape: RequestShape,
  parameters: readonly TransportParameter[],
): string {
  const input = inputOf(c, operation);
  return lines(
    doc(
      "Validated HTTP request projection",
      ["value"],
      "Placed parameter texts and JSON body or positioned violations",
    ),
    `public static Result<Projection, ContractFailure> Project(${c.type(input.id)} value) {`,
    `var encoded = ${shape === "binary" ? "EncodeParameters(value)" : `${c.codec(input.id)}.Encode(value, "http")`};`,
    "if (encoded.IsFailed(out var failed, out var json)) return failed;",
    "using var document = Wire.Parse(json);",
    "var root = document.RootElement;",
    ...parameters.map(
      ({ field, property }) =>
        `string? ${property} = root.TryGetProperty(${quote(field.wireName)}, out var e${property}) ? (e${property}.ValueKind == JsonValueKind.String ? e${property}.GetString() : e${property}.GetRawText()) : null;`,
    ),
    "string? body = null;",
    projectBody(c, operation, shape, parameters),
    `return Result.Succeeded(new Projection(${[...parameters.map(({ property }) => property), "body"].join(", ")}));`,
    "}",
  );
}

/** Strict JSON placement of one native HTTP parameter
 * @param c - Target context
 * @param parameter - Operation parameter position
 * @returns Positioned parameter acceptance statements
 */
function decodeParameter(c: CSharpContext, parameter: TransportParameter): string {
  const { field, argument } = parameter;
  return lines(
    `if (${argument} is not null) {`,
    "try {",
    `string token = ${isTextParameter(c, field) ? `Wire.Quote(${argument})` : argument};`,
    "using var parameter = Wire.Parse(token);",
    `writer.WritePropertyName(${quote(field.wireName)});`,
    "writer.WriteRawValue(parameter.RootElement.GetRawText(), skipInputValidation: true);",
    `} catch (Exception exception) when (exception is JsonException or EncoderFallbackException) { c.Add(Wire.At("", ${quote(field.wireName)}), "format"); }`,
    "}",
  );
}

/** Native HTTP acceptance declaration documentation
 * @param shape - Native body representation
 * @param parameters - Operation parameter positions
 * @returns Method documentation
 */
function decodeDocumentation(
  shape: RequestShape,
  parameters: readonly TransportParameter[],
): string {
  return doc(
    "Native HTTP request acceptance",
    [
      ...parameters.map(
        ({ argument, field }) =>
          [argument, `HTTP text of ${field.name} or null when absent`] as const,
      ),
      ...(shape === "none"
        ? []
        : ([["body", shape === "binary" ? "Native body bytes" : "JSON request body"]] as const)),
      ...(shape === "binary"
        ? ([["hasBody", "Presence of the native request body"]] as const)
        : []),
    ],
    "Completed operation input or positioned violations",
  );
}

/** Canonical input acceptance from native HTTP transport values
 * @param c - Target context
 * @param operation - HTTP operation
 * @param shape - Native body representation
 * @param parameters - Operation parameter positions
 * @returns Typed request acceptance method
 */
function decodeMethod(
  c: CSharpContext,
  operation: Operation,
  shape: RequestShape,
  parameters: readonly TransportParameter[],
): string {
  const input = inputOf(c, operation);
  const t = c.type(input.id);
  const bodyArgs =
    shape === "binary"
      ? ["ImmutableArray<byte> body", "bool hasBody"]
      : shape === "none"
        ? []
        : [shape === "member" ? "string? body" : "string body"];
  const accepted =
    shape === "none"
      ? `${c.codec(input.id)}.Decode(mapped, "http")`
      : `Decode(mapped, body${shape === "binary" ? ", hasBody" : ""})`;
  return lines(
    decodeDocumentation(shape, parameters),
    `public static Result<Accepted<${t}>, ContractFailure> DecodeRequest(${[...parameters.map(({ argument }) => `string? ${argument}`), ...bodyArgs].join(", ")}) {`,
    "var c = new ReadContext();",
    "using var stream = new MemoryStream();",
    "using (var writer = new Utf8JsonWriter(stream, Wire.WriterOptions)) {",
    "writer.WriteStartObject();",
    ...parameters.map((parameter) => decodeParameter(c, parameter)),
    "writer.WriteEndObject();",
    "}",
    `if (!c.IsValid) return c.Finish(default(${t})!);`,
    "string mapped = Encoding.UTF8.GetString(stream.GetBuffer(), 0, checked((int)stream.Length));",
    `return ${accepted};`,
    "}",
  );
}

/** Transport text projection and acceptance owned by the types assembly
 * @param c - Target context
 * @param operation - HTTP operation
 * @param shape - Native body representation
 * @returns Operation-specific transport seam members
 */
export function renderTransportMembers(
  c: CSharpContext,
  operation: Operation,
  shape: RequestShape,
): string {
  const input = inputOf(c, operation);
  const parameters = operation.http!.parameters.map((parameter, index) => ({
    field: input.fields.find((field) => field.name === parameter.parameter)!,
    property: `Parameter${index}`,
    argument: `parameter${index}`,
  }));
  return lines(
    projectionType(parameters),
    projectMethod(c, operation, shape, parameters),
    decodeMethod(c, operation, shape, parameters),
  );
}
