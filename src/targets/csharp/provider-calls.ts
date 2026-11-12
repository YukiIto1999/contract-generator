import type { Operation } from "../../model/contract-model.js";
import { acceptedType } from "./acceptance.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name, pascal } from "./naming.js";
import { opName } from "./outcome-codecs.js";
import { outcomeSwitch, renderResponseMethods } from "./provider-response.js";

/** Provider direct call through the same default acceptance
 * @param c - Target context
 * @param operation - Operation
 * @returns Provider method
 */
export function renderDirect(c: CSharpContext, operation: Operation): string {
  const failure = opName(operation, "Failure");
  const success = opName(operation, "Success");
  const effective = acceptedType(c, operation);
  const accepted = `Result<Accepted<${effective}>, ContractFailure>`;
  const acceptance = opName(operation, "Acceptance");
  return lines(
    doc(
      "Direct provider acceptance before handler dispatch",
      ["input", "deadline"],
      "Typed handler outcome or normal input failure",
    ),
    `public static Effect<IContractHandlers, ${failure}, ${success}> ${name(pascal(operation.name))}(${c.type(operation.input)} input, DateTimeOffset? deadline) {`,
    `var fx = new EffectContext<IContractHandlers, ${failure}>();`,
    `return fx.Try<bool>((_, token) => { token.ThrowIfCancellationRequested(); return new ValueTask<bool>(true); }, exception => throw exception).Bind(_ => fx.Sync(() => ${acceptance}.Accept(input))).Bind(accepted => {`,
    `if (accepted is ${accepted}.Failed invalid) return fx.Fail<${success}>(new ${failure}.InvalidInput(invalid.Failure));`,
    `return fx.Access(handlers => handlers.${name(pascal(operation.name))}(((${accepted}.Succeeded)accepted).Value.Value, deadline).MapFailure(rejection => (${failure})new ${failure}.Declared(rejection)));`,
    "});",
    "}",
  );
}

/** Rejection-aware IPC provider
 * @param c - Target context
 * @param operation - Operation
 * @returns Provider method
 */
export function renderIpcProvider(c: CSharpContext, operation: Operation): string {
  const failure = opName(operation, "Failure");
  const input = c.type(operation.input);
  const decoded = `Result<Accepted<${input}>, ContractFailure>`;
  return lines(
    doc(
      "IPC request acceptance and resolved rejection dispatch",
      ["parameters", "deadline"],
      "Resolved response envelope or input rejection",
      {
        throws: [["InvalidOperationException", "A handler result that breaks the contract"]],
      },
    ),
    `public static Effect<IContractHandlers, ${failure}, string> ${name(pascal(operation.name) + "Ipc")}(string parameters, DateTimeOffset? deadline) {`,
    `var fx = new EffectContext<IContractHandlers, ${failure}>();`,
    `var decoded = ${c.codec(operation.input)}.Decode(parameters, "ipc");`,
    `if (decoded is ${decoded}.Failed failed) return fx.Fail<string>(new ${failure}.InvalidInput(failed.Failure));`,
    `return ${name(pascal(operation.name))}(((${decoded}.Succeeded)decoded).Value.Value, deadline)`,
    `.Map(outcome => ${outcomeSwitch(operation, false, "outcome", "Ipc")})`,
    ".Recover(failure => failure switch {",
    `${failure}.InvalidInput invalid => fx.Fail<string>(invalid),`,
    `${failure}.Communication communication => fx.Fail<string>(communication),`,
    `${failure}.Declared declared => fx.Sync<string>(() => ${outcomeSwitch(operation, true, "declared.Rejection", "Ipc")}),`,
    "});",
    "}",
    renderResponseMethods(c, operation, "Ipc"),
  );
}
