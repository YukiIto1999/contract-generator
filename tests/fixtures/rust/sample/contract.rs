//! Hand-written adapter and operation dispatch of the sample contract, spelled with the literal generated names
use crate::host::{Call, Kind, configured, fixture, invalid, record};
use crate::observe;
use serde_json::Value;
use transport::{CancellationToken, HandlerFailure, Instant, OperationFailure};
use types::{Accepted, Binding};

/// Fixture-owned adapter with explicitly configured outcomes
pub struct Adapter {
    pub reply: Value,
}

impl provider::Handler for Adapter {
    async fn submit(&self, input: types::SubmitAccepted, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::SubmitSuccess, HandlerFailure<types::SubmitRejection>> {
        record("submit", format!("{{\"input\":{},\"limit\":{}}}", types::encode_envelope(input.input(), Binding::Ipc), input.limit()));
        let (outcome, body) = configured(&self.reply, "submit", token).await.ok_or(HandlerFailure::Cancelled)?;
        match outcome.as_str() {
            "Created" => Ok(types::SubmitSuccess::Created(fixture(types::decode_submit_created(&body, Binding::Ipc)))),
            "Queued" => Ok(types::SubmitSuccess::Queued(fixture(types::decode_submit_queued(&body, Binding::Ipc)))),
            "Completed" => Ok(types::SubmitSuccess::Completed),
            "Rejected" => Err(HandlerFailure::Rejected(types::SubmitRejection::Rejected(fixture(types::decode_submit_rejected(&body, Binding::Ipc))))),
            _ => panic!("configured outcome is undeclared"),
        }
    }

    async fn download(&self, _input: types::DownloadInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::DownloadSuccess, HandlerFailure<types::DownloadRejection>> {
        record("download", "{}".to_owned());
        let (outcome, body) = configured(&self.reply, "download", token).await.ok_or(HandlerFailure::Cancelled)?;
        match outcome.as_str() {
            "Downloaded" => Ok(types::DownloadSuccess::Downloaded(fixture(types::decode_download_downloaded(&body, Binding::Ipc)))),
            "Rejected" => Err(HandlerFailure::Rejected(types::DownloadRejection::Rejected(fixture(types::decode_download_rejected(&body, Binding::Ipc))))),
            _ => panic!("configured outcome is undeclared"),
        }
    }
}

/// Protocol observation of a submit result
fn observe_submit(result: Result<Accepted<types::SubmitSuccess>, OperationFailure<types::SubmitRejection>>) -> String {
    observe!(result,
        Ok(Accepted { value: types::SubmitSuccess::Created(v), diagnostics }) => ("success", "Created", types::encode_submit_created(&v, Binding::Ipc), false, diagnostics),
        Ok(Accepted { value: types::SubmitSuccess::Queued(v), diagnostics }) => ("success", "Queued", types::encode_submit_queued(&v, Binding::Ipc), false, diagnostics),
        Ok(Accepted { value: types::SubmitSuccess::Completed, diagnostics }) => ("success", "Completed", "null".to_owned(), true, diagnostics),
        Err(OperationFailure::Rejected(Accepted { value: types::SubmitRejection::Rejected(v), diagnostics })) => ("rejected", "Rejected", types::encode_submit_rejected(&v, Binding::Ipc), false, diagnostics),
    )
}

/// Protocol observation of a download result
fn observe_download(result: Result<Accepted<types::DownloadSuccess>, OperationFailure<types::DownloadRejection>>) -> String {
    observe!(result,
        Ok(Accepted { value: types::DownloadSuccess::Downloaded(v), diagnostics }) => ("success", "Downloaded", types::encode_download_downloaded(&v, Binding::Ipc), false, diagnostics),
        Err(OperationFailure::Rejected(Accepted { value: types::DownloadRejection::Rejected(v), diagnostics })) => ("rejected", "Rejected", types::encode_download_rejected(&v, Binding::Ipc), false, diagnostics),
    )
}

/// One operation call through the selected connection
pub async fn run(call: &Call) -> String {
    let (token, deadline) = (&call.token, call.deadline);
    match call.operation.as_str() {
        "submit" => {
            let input = match types::decode_submit_input(&call.parameters, call.wire()) { Ok(accepted) => accepted.value, Err(error) => return invalid(error) };
            match call.kind {
                Kind::Http => observe_submit(client::submit_http(call.http.as_ref().expect("HTTP transport"), input, token, deadline).await),
                Kind::Ipc => observe_submit(client::submit_ipc(call.ipc.as_ref().expect("IPC transport"), input, token, deadline).await),
                Kind::Direct => observe_submit(provider::submit_direct(&Adapter { reply: call.reply.clone() }, input, token, deadline).await),
            }
        }
        "download" => {
            let input = match types::decode_download_input(&call.parameters, call.wire()) { Ok(accepted) => accepted.value, Err(error) => return invalid(error) };
            match call.kind {
                Kind::Http => observe_download(client::download_http(call.http.as_ref().expect("HTTP transport"), input, token, deadline).await),
                Kind::Ipc => observe_download(client::download_ipc(call.ipc.as_ref().expect("IPC transport"), input, token, deadline).await),
                Kind::Direct => observe_download(provider::download_direct(&Adapter { reply: call.reply.clone() }, input, token, deadline).await),
            }
        }
        _ => panic!("fixture operation is undeclared"),
    }
}
