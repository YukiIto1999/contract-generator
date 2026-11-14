import type { Operation } from "../../model/contract-model.js";
import { node, type RustContext } from "./context.js";
import { doc, key, quote, snake, stem } from "./naming.js";

/** Deferred IPC consumer operation
 * @param ctx - Resolved generation context
 * @param operation - Canonical operation
 * @returns Generated standard Future entry point, or an empty string without an IPC binding
 */
export function renderIpc(ctx: RustContext, operation: Operation): string {
  if (!operation.ipc) return "";
  const op = snake(operation.name);
  const name = stem(operation);
  const input = node(ctx, operation.input);
  return `${doc(operation.description, "Deferred injected IPC operation without provider defaults")}
///
/// - transport: host-owned actual IPC connection
/// - input: accepted pre-default parameters
/// - token: original operation cancellation ownership
/// - deadline: original absolute host deadline, forwarded to the transport
/// - Return: fully decoded declared success
/// # Errors
/// Declared rejection or typed communication termination
/// # Panics
/// A result envelope or payload that violates the declared contract
pub async fn ${op}_ipc<T: IpcTransport>(transport: &T, input: ${input.name}, token: &CancellationToken, deadline: Option<Instant>) -> Result<Accepted<${name}Success>, OperationFailure<${name}Rejection>> {
    if token.is_cancelled() { return Err(OperationFailure::Cancelled); }
    let response = transport.invoke(${quote(operation.ipc.command)}, encode_${key(input)}(&input, Binding::Ipc), token, deadline).await.map_err(OperationFailure::from)?;
    decode_${op}_ipc_result(&response).map_err(OperationFailure::Rejected)
}
`;
}
