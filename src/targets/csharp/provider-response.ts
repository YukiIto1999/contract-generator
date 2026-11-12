import type { Operation, Outcome } from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import type { CSharpContext } from "./context.js";
import { isJsonMediaType, lines, name, pascal, quote } from "./naming.js";
import { opName } from "./outcome-codecs.js";
import { requireValue } from "./result-helpers.js";

/** Branches over the closed outcome family of a handler result
 * @param operation - Operation
 * @param rejection - Whether the declared rejections or the successes are matched
 * @param subject - Expression of the family value
 * @param render - Statements that answer one matched outcome through `value`
 * @param defect - Defect message for a value outside the family
 * @returns One guarded block per outcome and the defect that closes the hierarchy
 */
export function outcomeBranches(
  operation: Operation,
  rejection: boolean,
  subject: string,
  render: (outcome: Outcome) => string,
  defect: string,
): string {
  const family = opName(operation, rejection ? "Rejection" : "Success");
  return lines(
    ...operation.outcomes
      .filter((outcome) => outcome.rejection === rejection)
      .map(
        (outcome) =>
          `{ if (${subject} is ${family}.${name(pascal(outcome.name))} value) { ${render(outcome)} } }`,
      ),
    `throw new InvalidOperationException(${quote(defect)});`,
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
export function httpResponse(c: CSharpContext, operation: Operation, outcome: Outcome): string {
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
export function ipcResponse(operation: Operation, outcome: Outcome): string {
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
