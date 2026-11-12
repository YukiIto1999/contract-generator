import type { Operation } from "../../model/contract-model.js";
import { decodeOutcome } from "./client-outcome.js";
import { flatten } from "./client-http.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name, pascal, quote } from "./naming.js";
import { opName } from "./outcome-codecs.js";
import { requireValue } from "./result-helpers.js";

/** Branch of one declared IPC result tag
 * @param operation - Operation
 * @returns One switch case per declared tag
 */
function tagCases(operation: Operation): string {
  return lines(
    ...operation.ipc!.results.map((mapping) => {
      const outcome = operation.outcomes.find((o) => o.name === mapping.outcome)!;
      return lines(
        `case ${quote(mapping.tag)}: {`,
        outcome.type
          ? `if (!root.TryGetProperty("body", out var body)) throw new InvalidOperationException("Missing IPC payload");`
          : `if (root.TryGetProperty("body", out _)) throw new InvalidOperationException("Void IPC result has a body");`,
        decodeOutcome(operation, outcome, "body.GetRawText()", "ipc", false),
        "}",
      );
    }),
  );
}

/** IPC selected-tag consumer
 * @param c - Target context
 * @param operation - Operation
 * @returns Consumer method
 */
export function renderIpcClient(c: CSharpContext, operation: Operation): string {
  const failure = opName(operation, "Failure");
  const success = opName(operation, "Success");
  return lines(
    doc(
      "Injected IPC operation effect",
      ["input", "deadline"],
      "Selected success or typed failure",
      {
        throws: [["InvalidOperationException", "A response envelope that breaks the contract"]],
      },
    ),
    `public static Effect<IClientRequirements, ${failure}, ${success}> ${name(pascal(operation.name) + "Ipc")}(${c.type(operation.input)} input, DateTimeOffset? deadline) {`,
    `var fx = new EffectContext<IClientRequirements, ${failure}>();`,
    "return fx.Try<bool>((_, token) => { token.ThrowIfCancellationRequested(); return new ValueTask<bool>(true); }, exception => throw exception).Bind(_ => fx.Sync(() => {",
    requireValue("string", `${c.codec(operation.input)}.Encode(input, "ipc")`, "parameters"),
    "return parameters;",
    `})).Bind(parameters => fx.Access(requirements => requirements.Ipc.Invoke(${quote(operation.ipc!.command)}, parameters, deadline).MapFailure(failure => (${failure})new ${failure}.Communication(failure))))`,
    `.Bind(json => fx.Sync<Result<${success}, ${failure}>>(() => {`,
    "using var document = JsonDocument.Parse(json);",
    "var root = document.RootElement;",
    `if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("tag", out var tag) || tag.ValueKind != JsonValueKind.String) throw new InvalidOperationException("Invalid IPC response envelope");`,
    "switch (tag.GetString()) {",
    tagCases(operation),
    `default: throw new InvalidOperationException("Unknown IPC result tag"); }`,
    `})${flatten(operation)});`,
    "}",
  );
}
