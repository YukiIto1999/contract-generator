import type { Operation } from "../../model/contract-model.js";
import { inputOf } from "./acceptance.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name, pascal } from "./naming.js";
import { opName } from "./outcome-codecs.js";
import { acceptRequest } from "./provider-request.js";
import { outcomeSwitch, renderResponseMethods } from "./provider-response.js";

/** Native HTTP request acceptance and response serialization
 * @param c - Target context
 * @param operation - Operation
 * @returns Provider method
 */
export function renderHttpProvider(c: CSharpContext, operation: Operation): string {
  const failure = opName(operation, "Failure");
  const input = c.type(inputOf(c, operation).id);
  const accepted = `Result<Accepted<${input}>, ContractFailure>`;
  const direct = name(pascal(operation.name));
  return lines(
    doc(
      "Native HTTP acceptance and handler response dispatch",
      ["request"],
      "Native response or positioned input rejection",
      {
        throws: [["InvalidOperationException", "A handler result that breaks the contract"]],
      },
    ),
    `public static Effect<IContractHandlers, ${failure}, HttpResponseMessage> ${name(pascal(operation.name) + "Http")}(HttpRequestMessage request) {`,
    `var fx = new EffectContext<IContractHandlers, ${failure}>();`,
    `return fx.Try<${accepted}>(async (_, deadline, cancellationToken) => {`,
    acceptRequest(c, operation),
    `}, exception => exception is HttpRequestException or IOException ? new ${failure}.Communication(new("request-communication")) : throw exception)`,
    `.Bind(decoded => decoded.IsFailed(out var failed, out var accepted) ? fx.Fail<${opName(operation, "Success")}>(new ${failure}.InvalidInput(failed.Failure)) : ${direct}(accepted.Value))`,
    `.Map(outcome => ${outcomeSwitch(operation, false, "outcome", "Http")})`,
    ".Recover(failure => failure switch {",
    `${failure}.InvalidInput invalid => fx.Fail<HttpResponseMessage>(invalid),`,
    `${failure}.Communication communication => fx.Fail<HttpResponseMessage>(communication),`,
    `${failure}.Declared declared => fx.Sync<HttpResponseMessage>(() => ${outcomeSwitch(operation, true, "declared.Rejection", "Http")}),`,
    "});",
    "}",
    renderResponseMethods(c, operation, "Http"),
  );
}
