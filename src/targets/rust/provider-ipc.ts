import type { Operation } from "../../model/contract-model.js";
import { node, type RustContext } from "./context.js";
import { key, quote, snake, stem } from "./naming.js";

/** IPC provider dispatch for a declared command
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Match arm for injected IPC hosts
 */
function ipcArm(ctx: RustContext, operation: Operation): string {
  const ipc = operation.ipc;
  if (ipc === undefined) return "";
  const op = snake(operation.name);
  const name = stem(operation);
  const arms = operation.outcomes.map((outcome) => {
    const pattern = outcome.rejection
      ? `Err(HandlerFailure::Rejected(${name}Rejection::${outcome.name}${outcome.type ? "(value)" : ""}))`
      : `Ok(${name}Success::${outcome.name}${outcome.type ? "(value)" : ""})`;
    return `${pattern} => ${outcome.rejection ? "Err" : "Ok"}(${name}${outcome.rejection ? "Rejection" : "Success"}::${outcome.name}${outcome.type ? "(value)" : ""}),`;
  });
  return `${quote(ipc.command)} => {
    let accepted = decode_${key(node(ctx, operation.input))}(&parameters, Binding::Ipc).map_err(ProviderFailure::InvalidInput)?;
    let outcome = handler.${op}(accept_${op}(accepted.value), token, deadline).await;
    let value = match outcome { ${arms.join("\n")}
      Err(HandlerFailure::Cancelled) => return Err(ProviderFailure::Cancelled),
    };
    Ok(Accepted { value: encode_${op}_ipc_result(value), diagnostics: accepted.diagnostics })
  },`;
}

/** Injected IPC command dispatch without host-specific registration
 * @param ctx - Rendering context
 * @returns Rust dispatch function, or an empty string when no operation is published over IPC
 */
export function renderIpcDispatch(ctx: RustContext): string {
  const arms = ctx.model.operations.map((operation) => ipcArm(ctx, operation)).join("\n");
  if (arms.trim() === "") return "";
  return `/// Injected IPC provider without host-specific command registration
///
/// - handler: contract adapter
/// - command: actual received command identifier
/// - parameters: complete UTF-8 IPC parameters JSON
/// - token: original cancellation
/// - deadline: original host deadline
/// - Return: resolved declared result envelope
/// # Errors
/// Normal input violations, a command no operation publishes, or cancellation
pub async fn dispatch_ipc<H: Handler>(handler: &H, command: &str, parameters: String, token: &CancellationToken, deadline: Option<Instant>) -> Result<Accepted<String>, ProviderFailure> {
    if token.is_cancelled() { return Err(ProviderFailure::Cancelled); }
    match command { ${arms}
      _ => Err(ProviderFailure::UnknownOperation),
    }
}
`;
}
