import type { Operation } from "../../model/contract-model.js";
import { flatten } from "./client-http.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name, pascal, quote } from "./naming.js";
import { opName } from "./outcome-codecs.js";
import { requireValue } from "./result-helpers.js";

/** IPC selected-tag consumer
 * @param c - Target context
 * @param operation - Operation
 * @returns Consumer method
 */
export function renderIpcClient(c: CSharpContext, operation: Operation): string {
  const failure = opName(operation, "Failure");
  const success = opName(operation, "Success");
  return lines(
    doc("Injected IPC operation effect", ["input"], "Selected success or typed failure", {
      throws: [["InvalidOperationException", "A response envelope that breaks the contract"]],
    }),
    `public static Effect<IClientRequirements, ${failure}, ${success}> ${name(pascal(operation.name) + "Ipc")}(${c.type(operation.input)} input) {`,
    `var fx = new EffectContext<IClientRequirements, ${failure}>();`,
    "return fx.Try<Result<string, CommunicationFailure>>(async (requirements, deadline, cancellationToken) => {",
    requireValue(`${c.codec(operation.input)}.Encode(input, "ipc")`, "parameters"),
    `return await requirements.Ipc.Invoke(${quote(operation.ipc!.command)}, parameters, deadline, cancellationToken).ConfigureAwait(false);`,
    `}, exception => throw exception).Bind(result => result.IsFailed(out var failed, out var json) ? fx.Fail<string>(new ${failure}.Communication(failed.Failure)) : fx.Succeed(json))`,
    `.Bind(json => fx.Sync<Result<${success}, ${failure}>>(() => ${opName(operation, "OutcomeCodecs")}.DecodeIpcEnvelope(json))${flatten(operation)});`,
    "}",
  );
}
