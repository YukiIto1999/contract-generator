import type { Operation } from "../../model/contract-model.js";
import { complete } from "./client-complete.js";
import { node, type RustContext } from "./context.js";
import { doc, key, quote, snake, stem } from "./naming.js";

/** Match arm of one declared result tag
 * @param operation - Canonical operation
 * @param mapping - Result tag mapping
 * @returns Rust arm decoding the envelope body for the selected outcome
 */
function tagArm(
  operation: Operation,
  mapping: { readonly outcome: string; readonly tag: string },
): string {
  const outcome = operation.outcomes.find((candidate) => candidate.name === mapping.outcome);
  if (outcome === undefined) return "";
  const body = outcome.type
    ? 'let Some(body) = body else { panic!("a payload IPC result requires a body even for null"); };'
    : 'if body.is_some() { panic!("a void IPC result must omit its body"); }';
  return `${quote(mapping.tag)} => { ${body} ${complete(operation, outcome, "body", "false", false)} },`;
}

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
    let response = transport.invoke(${quote(operation.ipc.command)}, encode_${key(input)}_value(&input, Binding::Ipc), token, deadline).await.map_err(OperationFailure::from)?;
    let Value::Object(mut envelope) = response else { panic!("an IPC result envelope must be an object"); };
    let Some(Value::String(tag)) = envelope.remove("tag") else { panic!("an IPC result tag must be present"); };
    let body = envelope.remove("body");
    let diagnostics: Vec<Diagnostic> = envelope.into_iter().map(|(key, _)| Diagnostic { path: format!("/{}", key.replace('~', "~0").replace('/', "~1")), key }).collect();
    ${operation.outcomes.some((outcome) => outcome.type !== undefined) ? "let binding = Binding::Ipc;" : ""}
    let result = match tag.as_str() { ${operation.ipc.results.map((mapping) => tagArm(operation, mapping)).join("\n")}
      _ => panic!("an IPC result tag is not declared"),
    };
    match result { Ok(mut accepted) => { accepted.diagnostics.extend(diagnostics); Ok(accepted) }, Err(OperationFailure::Rejected(mut rejected)) => { rejected.diagnostics.extend(diagnostics); Err(OperationFailure::Rejected(rejected)) }, Err(other) => Err(other) }
}
`;
}
