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
  const arms = ipc.results.map((mapping) => {
    const outcome = operation.outcomes.find((candidate) => candidate.name === mapping.outcome);
    if (outcome === undefined) return "";
    const pattern = outcome.rejection
      ? `Err(HandlerFailure::Rejected(${name}Rejection::${outcome.name}${outcome.type ? "(value)" : ""}))`
      : `Ok(${name}Success::${outcome.name}${outcome.type ? "(value)" : ""})`;
    const body = outcome.type
      ? `object.insert("body".into(), encode_${op}_${snake(outcome.name)}(&value, Binding::Ipc));`
      : "";
    return `${pattern} => { let mut object = serde_json::Map::new(); object.insert("tag".into(), Value::String(${quote(mapping.tag)}.into())); ${body} Value::Object(object) },`;
  });
  return `${quote(ipc.command)} => {
    let accepted = decode_${key(node(ctx, operation.input))}_value(parameters, Binding::Ipc).map_err(ProviderFailure::InvalidInput)?;
    let outcome = handler.${op}(accept_${op}(accepted.value), token, deadline).await;
    let value = match outcome { ${arms.join("\n")}
      Err(HandlerFailure::Cancelled) => return Err(ProviderFailure::Cancelled),
    };
    Ok(Accepted { value, diagnostics: accepted.diagnostics })
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
/// - parameters: actual parsed IPC parameters object
/// - token: original cancellation
/// - deadline: original host deadline
/// - Return: resolved declared result envelope
/// # Errors
/// Normal input violations, a command no operation publishes, or cancellation
pub async fn dispatch_ipc<H: Handler>(handler: &H, command: &str, parameters: Value, token: &CancellationToken, deadline: Option<Instant>) -> Result<Accepted<Value>, ProviderFailure> {
    if token.is_cancelled() { return Err(ProviderFailure::Cancelled); }
    match command { ${arms}
      _ => Err(ProviderFailure::UnknownOperation),
    }
}
`;
}
