import type { RustContext } from "./context.js";

/** Failures reported by an injected mechanism, with the termination reasons the host owns */
const communicationFailure = String.raw`/// Expected inability to get or finish a response, reported by an injected transport
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CommunicationFailure {
    /// No complete response was obtained: connection failure, interrupted response body, or a request that has no wire form
    #[error("communication failed")]
    Failed,
    /// Cooperative termination requested by the supplied owner
    #[error("operation cancelled")]
    Cancelled,
    /// Expiry of the forwarded deadline, reported only by a host-owned transport that enforces it
    #[error("host deadline exceeded")]
    DeadlineExceeded,
}
`;

/** Failure classes of a consumer operation: declared rejection, communication failure, and termination reasons */
const operationFailure = String.raw`/// Operation failure with declared rejection separate from communication
///
/// - R: generated declared rejection payload type
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum OperationFailure<R: std::fmt::Debug> {
    /// Declared rejection payload
    #[error("declared operation rejection")]
    Rejected(Accepted<R>),
    /// No complete response was obtained
    #[error("communication failed")]
    Communication,
    /// Cooperative cancellation termination
    #[error("operation cancelled")]
    Cancelled,
    /// Expiry of the forwarded deadline reported by the host-owned transport
    #[error("host deadline exceeded")]
    DeadlineExceeded,
}
impl<R: std::fmt::Debug> From<CommunicationFailure> for OperationFailure<R> {
    /// Termination preservation without inspecting later cancellation
    ///
    /// - failure: completed transport termination
    /// - Return: same termination in the operation failure path
    fn from(failure: CommunicationFailure) -> Self {
        match failure {
            CommunicationFailure::Failed => Self::Communication,
            CommunicationFailure::Cancelled => Self::Cancelled,
            CommunicationFailure::DeadlineExceeded => Self::DeadlineExceeded,
        }
    }
}
`;

/** Failure classes of the contract adapter and of the provider boundary */
const providerFailures = String.raw`/// Contract adapter termination without communication policy
///
/// - R: generated declared rejection payload type
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum HandlerFailure<R: std::fmt::Debug> {
    /// Declared normal rejection
    #[error("declared operation rejection")]
    Rejected(R),
    /// Cooperative cancellation termination after owned cleanup
    #[error("operation cancelled")]
    Cancelled,
}
/// Provider boundary result before a declared result envelope: the host decides how to answer each case
#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ProviderFailure {
    /// Normal input violations without handler dispatch
    #[error("request validation failed")]
    InvalidInput(ValidationFailure),
    /// No operation is published for the received command, method and route
    #[error("no published operation matches")]
    UnknownOperation,
    /// Interrupted native request body
    #[error("communication failed")]
    Communication,
    /// Cooperative cancellation termination
    #[error("operation cancelled")]
    Cancelled,
}
`;

/** Host-owned IPC connection contract and the shared media-type helper */
const mechanisms = String.raw`/// Injected IPC connection owned by the embedding host
pub trait IpcTransport: Send + Sync {
    /// Deferred invocation over the host's actual connection
    ///
    /// - self: host-owned connection
    /// - command: generated command identifier
    /// - parameters: complete binding-encoded parameters object
    /// - token: original operation cancellation ownership
    /// - deadline: original absolute host deadline, enforced only by the host
    /// - Return: resolved declared result envelope or expected communication termination
    /// # Errors
    /// Typed communication failures, cancellation or deadline expiry from the native transport
    fn invoke(&self, command: &str, parameters: String, token: &CancellationToken, deadline: Option<Instant>) -> impl Future<Output = Result<String, CommunicationFailure>> + Send;
}
/// Media-type essence normalization without parameter matching
///
/// - value: Content-Type value
/// - Return: borrowed media-type essence
pub fn essence(value: &str) -> &str { value.split_once(';').map_or(value, |(essence, _)| essence).trim() }
`;

/** Shared injected transport contracts without a generated effect system
 * @param ctx - Resolved rendering context
 * @returns Standard Future and Result transport interfaces
 */
export function renderTransport(ctx: RustContext): string {
  const types = `${ctx.prefix.replace(/-/g, "_")}_types`;
  return `//! Host-owned communication failures and cancellation metadata
use ${types}::{Accepted, ValidationFailure};
use std::future::Future;
pub use tokio::time::Instant;
pub use tokio_util::sync::CancellationToken;
${communicationFailure}${operationFailure}${providerFailures}${mechanisms}`;
}
