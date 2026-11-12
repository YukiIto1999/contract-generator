import type { Field, Operation } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { inputOf } from "./acceptance.js";
import { lines, name, pascal, quote } from "./naming.js";
import { isJsonMediaType } from "./naming.js";
import { planFields, type FieldPlan } from "./object-plan.js";
import { readUse, writeUse } from "./use-codec.js";

/** How the HTTP request carries the operation input beside its placed parameters */
export type RequestShape = "none" | "parameters" | "member" | "binary";

/** Raw binary HTTP body interpretation
 * @param c - Target context
 * @param operation - Operation
 * @returns Selected raw byte body field
 */
export function binaryBody(c: CSharpContext, operation: Operation): Field | undefined {
  const http = operation.http;
  if (!http || http.body.kind !== "parameter" || isJsonMediaType(http.requestMediaType))
    return undefined;
  const parameter = http.body.parameter;
  const field = inputOf(c, operation).fields.find((candidate) => candidate.name === parameter);
  const node = field && c.node(field.type.id);
  return node?.kind === "scalar" && node.scalar === "bytes" ? field : undefined;
}

/** Request body interpretation of an operation
 * @param c - Target context
 * @param operation - Operation
 * @returns Shape of the request body relative to the placed parameters
 */
export function requestShape(c: CSharpContext, operation: Operation): RequestShape {
  const body = operation.http?.body;
  if (body === undefined || body.kind === "none") return "none";
  if (body.kind === "parameters") return "parameters";
  return binaryBody(c, operation) ? "binary" : "member";
}

/** Wire names of the input members that travel in the path, the query or a header
 * @param c - Target context
 * @param operation - Operation
 * @returns JSON member names that a request body never overrides
 */
function placedNames(c: CSharpContext, operation: Operation): readonly string[] {
  const placed = new Set(operation.http!.parameters.map((parameter) => parameter.parameter));
  return inputOf(c, operation)
    .fields.filter((field) => placed.has(field.name))
    .map((field) => field.wireName);
}

/** Decode entry that merges the placed parameters with a request body
 * @param c - Target context
 * @param operation - Operation
 * @param shape - Body shape, parameters or member
 * @returns Class members
 */
function mergedDecode(
  c: CSharpContext,
  operation: Operation,
  shape: "parameters" | "member",
): string {
  const input = inputOf(c, operation);
  const t = c.type(input.id);
  const body = operation.http!.body;
  const member =
    body.kind === "parameter" ? input.fields.find((f) => f.name === body.parameter)! : undefined;
  const merge =
    shape === "parameters"
      ? "Wire.MergeObject(parameters, body, Placed, c)"
      : `Wire.MergeMember(parameters, ${quote(member!.wireName)}, body, c)`;
  return lines(
    doc(
      "Wire names of the members that the path, the query and the headers supply",
      [],
      undefined,
      {
        value: "Names that a request body member never overrides",
      },
    ),
    `private static readonly string[] Placed = [${placedNames(c, operation).map(quote).join(", ")}];`,
    doc(
      "Acceptance of the placed parameters together with the request body",
      [
        ["parameters", "JSON object holding the parameters placed outside the body"],
        [
          "body",
          shape === "parameters"
            ? "Request body text; an empty body is an object without members"
            : "Request body text, or null when the request carries no body",
        ],
      ],
      "Accepted input, or positioned violations; a body member that repeats a placed parameter is dropped and reported as an unknown member",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Decode(string parameters, ${shape === "parameters" ? "string" : "string?"} body) {`,
    "var c = new ReadContext();",
    `var merged = ${merge};`,
    `return merged is null ? c.Finish(default(${t})!) : Wire.Decode(merged, ${c.codec(input.id)}.Read, "http", c);`,
    "}",
  );
}

/** Nonbody parameter projection of a binary request
 * @param c - Target context
 * @param operation - Operation
 * @param plans - Input field plans
 * @param body - Binary body field
 * @returns Encoder member
 */
function binaryEncode(
  c: CSharpContext,
  operation: Operation,
  plans: readonly FieldPlan[],
  body: Field,
): string {
  const input = inputOf(c, operation);
  const t = c.type(input.id);
  const parameters = plans.filter((plan) => plan.field !== body);
  const members = parameters.map((plan) => {
    const value = `value.${plan.property}`;
    const write = `writer.WritePropertyName(${quote(plan.field.wireName)}); ${writeUse(c, plan.field.type, plan.field.optional ? `${value}.Value` : value)}`;
    return plan.field.optional ? `if (${value}.IsPresent) { ${write} }` : write;
  });
  return lines(
    doc(
      "Nonbody parameter projection without byte conversion",
      [["value", "Operation input"]],
      "HTTP parameter JSON or positioned violations",
    ),
    `public static Result<string, ContractFailure> EncodeParameters(${t} value) {`,
    `var checkedValue = ${c.codec(input.id)}.Validate(value);`,
    `if (checkedValue is Result<Accepted<${t}>, ContractFailure>.Failed failed) return new Result<string, ContractFailure>.Failed(failed.Failure);`,
    "return new Result<string, ContractFailure>.Succeeded(Wire.Encode(value, (writer, value, binding, encoding) => {",
    "writer.WriteStartObject();",
    ...members,
    `writer.WriteEndObject();`,
    `}, "http"));`,
    "}",
  );
}

/** Reader of one member of a binary request
 * @param c - Target context
 * @param node - Operation input codec qualifier source
 * @param plan - Field plan
 * @param body - Binary body field
 * @returns Statements that bind `f{index}`
 */
function binaryMember(c: CSharpContext, owner: string, plan: FieldPlan, body: Field): string {
  const { field, index } = plan;
  const pointer = `Wire.At(path, ${quote(field.wireName)})`;
  const present = field.optional ? `Presence<${c.use(field.type)}>.Present(decoded)` : "decoded";
  const verify = plan.check.call("decoded", pointer, true, owner);
  const read =
    field === body
      ? `${c.codec(field.type.id)}.ReadBytes(body, c, ${pointer})`
      : readUse(c, field.type, `e${index}`, pointer);
  const guard =
    field === body
      ? "hasBody"
      : `element.TryGetProperty(${quote(field.wireName)}, out var e${index})`;
  return lines(
    `${c.field(field)} f${index} = default!;`,
    `if (${guard}) { int before = c.ViolationCount; var decoded = ${read}; ${verify && `if (c.ViolationCount == before) { ${verify} }`} f${index} = ${present}; }`,
    !field.optional && `else c.Add(${pointer}, "required");`,
  );
}

/** Decode entry of a request whose body is raw bytes beside JSON parameters
 * @param c - Target context
 * @param operation - Operation
 * @param plans - Input field plans
 * @param body - Binary body field
 * @returns Decoder member
 */
function binaryDecode(
  c: CSharpContext,
  operation: Operation,
  plans: readonly FieldPlan[],
  body: Field,
): string {
  const input = inputOf(c, operation);
  const t = c.type(input.id);
  const parameters = plans.filter((plan) => plan.field !== body);
  return lines(
    doc(
      "Acceptance of native bytes together with the placed JSON parameters",
      [
        ["parameters", "JSON object holding the parameters placed outside the body"],
        ["body", "Raw request body bytes"],
        ["hasBody", "Whether the request carries a body"],
      ],
      "Single completed input graph or positioned violations",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Decode(string parameters, ImmutableArray<byte> body, bool hasBody) {`,
    `return Wire.Decode<${t}>(parameters, (element, c, path, binding, encoding) => {`,
    `if (element.ValueKind != JsonValueKind.Object) { c.Add(path, "type"); return default!; }`,
    "var seen = new HashSet<string>(StringComparer.Ordinal);",
    "foreach (var property in element.EnumerateObject()) {",
    "if (!Wire.TryName(property, c, path, out var propertyName)) continue;",
    "switch (propertyName) {",
    ...parameters.map((plan) => `case ${quote(plan.field.wireName)}:`),
    parameters.length > 0 &&
      `if (!seen.Add(propertyName)) c.Add(Wire.At(path, propertyName), "format"); break;`,
    `case ${quote(body.wireName)}: c.Add(Wire.At(path, propertyName), "format"); break;`,
    "default: c.Unknown(path, propertyName); break;",
    "} }",
    ...plans.map((plan) => binaryMember(c, c.codec(input.id), plan, body)),
    `return c.IsValid ? ${t}.Complete(${plans.map((plan) => `f${plan.index}`).join(", ")}) : default!;`,
    `}, "http");`,
    "}",
  );
}

/** HTTP request projection that the generic input codec cannot express
 * @param c - Target context
 * @param operation - Operation
 * @returns Public static class, or nothing when the placed parameters and the body fit one JSON object
 */
export function renderHttpRequestCodec(c: CSharpContext, operation: Operation): string {
  const shape = requestShape(c, operation);
  if (shape === "none") return "";
  const body = binaryBody(c, operation);
  const members =
    shape === "binary" && body
      ? lines(
          binaryEncode(c, operation, planFields(c, inputOf(c, operation)), body),
          binaryDecode(c, operation, planFields(c, inputOf(c, operation)), body),
        )
      : mergedDecode(c, operation, shape === "parameters" ? "parameters" : "member");
  return lines(
    doc(
      `HTTP request projection of ${operation.name} for the types assembly, which alone can complete the input`,
    ),
    `public static class ${name(pascal(operation.name) + "HttpRequestCodec")} {`,
    members,
    "}",
  );
}
