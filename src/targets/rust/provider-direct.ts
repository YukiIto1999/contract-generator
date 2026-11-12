import type { Operation } from "../../model/contract-model.js";
import { node, type RustContext } from "./context.js";
import { doc, snake, stem } from "./naming.js";

/** Handler output assertions for the outcomes of one result path
 * @param operation - Canonical operation
 * @param rejection - Rejection outcomes rather than successes
 * @returns Rust statement asserting declared payloads, or an empty string when no payload exists
 */
function assertions(operation: Operation, rejection: boolean): string {
  const name = `${stem(operation)}${rejection ? "Rejection" : "Success"}`;
  const typed = operation.outcomes.filter(
    (outcome) => outcome.rejection === rejection && outcome.type !== undefined,
  );
  const call = (outcome: (typeof typed)[number]): string =>
    `assert_${snake(operation.name)}_${snake(outcome.name)}(payload);`;
  const [only] = typed;
  if (only === undefined) return "";
  const total = operation.outcomes.filter((outcome) => outcome.rejection === rejection).length;
  if (typed.length === 1 && total === 1)
    return `let ${name}::${only.name}(payload) = &value; ${call(only)}`;
  if (typed.length === 1) return `if let ${name}::${only.name}(payload) = &value { ${call(only)} }`;
  const arms = typed.map((outcome) => `${name}::${outcome.name}(payload) => { ${call(outcome)} },`);
  const untyped = operation.outcomes.some(
    (outcome) => outcome.rejection === rejection && outcome.type === undefined,
  );
  return `match &value { ${arms.join("\n")} ${untyped ? "_ => {}," : ""} }`;
}

/** Same-language direct operation through provider acceptance
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Standard async provider entry point
 */
export function renderDirect(ctx: RustContext, operation: Operation): string {
  const op = snake(operation.name);
  const name = stem(operation);
  return `${doc(operation.description, "Direct provider dispatch through omission-only acceptance")}
///
/// - handler: hand-written contract adapter
/// - input: accepted pre-default parameters
/// - token: original host cancellation
/// - deadline: original absolute host deadline
/// - Return: declared successful handler result
/// # Errors
/// Declared rejection or cooperative cancellation
/// # Panics
/// Contract adapter output violating its declared payload
pub async fn ${op}_direct<H: Handler>(handler: &H, input: ${node(ctx, operation.input).name}, token: &CancellationToken, deadline: Option<Instant>) -> Result<Accepted<${name}Success>, OperationFailure<${name}Rejection>> {
    if token.is_cancelled() { return Err(OperationFailure::Cancelled); }
    match handler.${op}(accept_${op}(input), token, deadline).await {
        Ok(value) => {
            ${assertions(operation, false)}
            Ok(Accepted { value, diagnostics: vec![] })
        },
        Err(HandlerFailure::Rejected(value)) => {
            ${assertions(operation, true)}
            Err(OperationFailure::Rejected(Accepted { value, diagnostics: vec![] }))
        },
        Err(HandlerFailure::Cancelled) => Err(OperationFailure::Cancelled),
    }
}
`;
}
