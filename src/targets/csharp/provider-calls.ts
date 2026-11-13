import type { Operation } from "../../model/contract-model.js";
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
  const acceptance = opName(operation, "Acceptance");
  return lines(
    doc(
      "Direct provider acceptance before handler dispatch",
      ["input"],
      "Typed handler outcome or normal input failure",
    ),
    `public static Effect<IContractHandlers, ${failure}, ${success}> ${name(pascal(operation.name))}(${c.type(operation.input)} input) {`,
    `var fx = new EffectContext<IContractHandlers, ${failure}>();`,
    `return fx.Sync(() => ${acceptance}.Accept(input)).Bind(accepted => {`,
    `if (accepted.IsFailed(out var invalid, out var inputValue)) return fx.Fail<${success}>(new ${failure}.InvalidInput(invalid.Failure));`,
    `return fx.Access(handlers => handlers.${name(pascal(operation.name))}(inputValue.Value).MapFailure(rejection => (${failure})new ${failure}.Declared(rejection)));`,
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
  return lines(
    doc(
      "IPC request acceptance and resolved rejection dispatch",
      ["parameters"],
      "Resolved response envelope or input rejection",
      {
        throws: [["InvalidOperationException", "A handler result that breaks the contract"]],
      },
    ),
    `public static Effect<IContractHandlers, ${failure}, string> ${name(pascal(operation.name) + "Ipc")}(string parameters) {`,
    `var fx = new EffectContext<IContractHandlers, ${failure}>();`,
    `var decoded = ${c.codec(operation.input)}.Decode(parameters, "ipc");`,
    `if (decoded.IsFailed(out var failed, out var inputValue)) return fx.Fail<string>(new ${failure}.InvalidInput(failed.Failure));`,
    `return ${name(pascal(operation.name))}(inputValue.Value)`,
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
