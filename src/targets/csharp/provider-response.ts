import type { Operation, Outcome } from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { doc } from "./docs.js";
import type { CSharpContext } from "./context.js";
import { isJsonMediaType, lines, name, pascal, quote } from "./naming.js";
import { opName } from "./outcome-codecs.js";
import { requireValue } from "./result-helpers.js";

/** Exhaustive expression over one closed handler outcome family
 * @param operation - Operation
 * @param rejection - Whether declared rejections or successes are matched
 * @param subject - Expression of the family value
 * @param binding - Response serialization binding
 * @returns Switch expression invoking the corresponding typed response overload
 */
export function outcomeSwitch(
  operation: Operation,
  rejection: boolean,
  subject: string,
  binding: "Http" | "Ipc",
): string {
  const outcomes = operation.outcomes.filter((outcome) => outcome.rejection === rejection);
  if (outcomes.length === 0)
    return 'throw new InvalidOperationException("Invalid handler rejection")';
  const family = opName(operation, rejection ? "Rejection" : "Success");
  return lines(
    `${subject} switch {`,
    ...outcomes.map(
      (outcome) =>
        `${family}.${name(pascal(outcome.name))} value => ${opName(operation, binding + "Response")}(value),`,
    ),
    "}",
  );
}

/** Content of a response whose result carries a payload
 * @param c - Target context
 * @param operation - Operation
 * @param outcome - Outcome with a payload
 * @param mediaType - Declared response media type
 * @returns Statements that assign `response.Content` and its media type
 */
function responseContent(
  c: CSharpContext,
  operation: Operation,
  outcome: Outcome,
  mediaType: string,
): string {
  const use = outcome.type!;
  const node = c.node(use.id);
  const codecs = opName(operation, "OutcomeCodecs");
  const raw = node.kind === "scalar" && node.scalar === "bytes" && !isJsonMediaType(mediaType);
  const bytes = node.kind === "scalar" && node.role !== null ? "value.Value.Value" : "value.Value";
  return lines(
    raw
      ? lines(
          `if (${codecs}.Validate${outcome.name}(value.Value) is Result<Accepted<${c.use(use)}>, ContractFailure>.Failed) throw new InvalidOperationException("Invalid handler byte payload before wire output");`,
          `response.Content = new ReadOnlyMemoryContent(${bytes}.AsMemory());`,
        )
      : lines(
          requireValue("string", `${codecs}.Encode${outcome.name}(value.Value, "http")`, "body"),
          "response.Content = new StringContent(body, Encoding.UTF8);",
        ),
    `response.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(${quote(mediaType)});`,
  );
}

/** Native HTTP response serialization
 * @param c - Target context
 * @param operation - Operation
 * @param outcome - Outcome
 * @returns Statements that return the response
 */
function httpResponse(c: CSharpContext, operation: Operation, outcome: Outcome): string {
  const mapping = operation.http!.results.find((m) => m.outcome === outcome.name)!;
  return lines(
    `var response = new HttpResponseMessage((System.Net.HttpStatusCode)${mapping.status});`,
    outcome.type && responseContent(c, operation, outcome, mapping.mediaType!),
    ...Object.entries(mapping.headers)
      .sort(([left], [right]) => compareText(left, right))
      .map(
        ([key, value]) =>
          `if (!response.Headers.TryAddWithoutValidation(${quote(key)}, ${quote(value)})) response.Content.Headers.TryAddWithoutValidation(${quote(key)}, ${quote(value)});`,
      ),
    "return response;",
  );
}

/** Outcome-to-envelope JSON output
 * @param operation - Operation
 * @param outcome - Outcome
 * @returns Statements that return the envelope text
 */
function ipcResponse(operation: Operation, outcome: Outcome): string {
  const tag = operation.ipc!.results.find((r) => r.outcome === outcome.name)!.tag;
  return lines(
    outcome.type &&
      requireValue(
        "string",
        `${opName(operation, "OutcomeCodecs")}.Encode${outcome.name}(value.Value, "ipc")`,
        "body",
      ),
    "using var stream = new MemoryStream();",
    `using (var writer = new Utf8JsonWriter(stream)) { writer.WriteStartObject(); writer.WriteString("tag", ${quote(tag)}); ${outcome.type ? 'writer.WritePropertyName("body"); writer.WriteRawValue(body);' : ""} writer.WriteEndObject(); }`,
    "return Encoding.UTF8.GetString(stream.ToArray());",
  );
}

/** Typed serializers selected by the closed outcome switches
 * @param c - Target context
 * @param operation - Operation
 * @param binding - Response serialization binding
 * @returns One response overload per outcome
 */
export function renderResponseMethods(
  c: CSharpContext,
  operation: Operation,
  binding: "Http" | "Ipc",
): string {
  const response = binding === "Http" ? "HttpResponseMessage" : "string";
  return lines(
    ...operation.outcomes.map((outcome) =>
      lines(
        doc("Validated handler outcome output", ["value"], "Resolved response", {
          throws: [["InvalidOperationException", "A handler payload that breaks the contract"]],
        }),
        `private static ${response} ${opName(operation, binding + "Response")}(${opName(operation, outcome.rejection ? "Rejection" : "Success")}.${name(pascal(outcome.name))} value) {`,
        binding === "Http" ? httpResponse(c, operation, outcome) : ipcResponse(operation, outcome),
        "}",
      ),
    ),
  );
}
