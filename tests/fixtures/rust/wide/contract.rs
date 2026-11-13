//! Hand-written adapter and operation dispatch of the wide contract, spelled with the literal generated names
use crate::host::{Call, Kind, configured, fixture, invalid, record};
use crate::observe;
use serde_json::{Value, json};
use transport::{CancellationToken, HandlerFailure, Instant, OperationFailure};
use types::{Accepted, Binding};

/// Fixture-owned adapter with explicitly configured outcomes
pub struct Adapter {
    pub reply: Value,
}

impl provider::Handler for Adapter {
    async fn lookup(&self, input: types::LookupInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::LookupSuccess, HandlerFailure<types::LookupRejection>> {
        record("lookup", types::encode_lookup_input(&input, Binding::Ipc));
        let (outcome, body) = configured(&self.reply, "lookup", token).await.ok_or(HandlerFailure::Cancelled)?;
        match outcome.as_str() {
            "Primary" => Ok(types::LookupSuccess::Primary(fixture(types::decode_lookup_primary(&body, Binding::Ipc)))),
            "Replica" => Ok(types::LookupSuccess::Replica(fixture(types::decode_lookup_replica(&body, Binding::Ipc)))),
            "Missing" => Err(HandlerFailure::Rejected(types::LookupRejection::Missing(fixture(types::decode_lookup_missing(&body, Binding::Ipc))))),
            "Unavailable" => Err(HandlerFailure::Rejected(types::LookupRejection::Unavailable(fixture(types::decode_lookup_unavailable(&body, Binding::Ipc))))),
            _ => panic!("configured outcome is undeclared"),
        }
    }

    async fn store(&self, input: types::StoreInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::StoreSuccess, HandlerFailure<types::StoreRejection>> {
        record("store", types::encode_store_input(&input, Binding::Ipc));
        let (outcome, body) = configured(&self.reply, "store", token).await.ok_or(HandlerFailure::Cancelled)?;
        match outcome.as_str() {
            "Stored" => Ok(types::StoreSuccess::Stored),
            "Conflict" => Err(HandlerFailure::Rejected(types::StoreRejection::Conflict(fixture(types::decode_store_conflict(&body, Binding::Ipc))))),
            _ => panic!("configured outcome is undeclared"),
        }
    }

    async fn batch(&self, input: types::BatchAccepted, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::BatchSuccess, HandlerFailure<types::BatchRejection>> {
        record("batch", format!("{{\"cursor\":{},\"mode\":{},\"note\":{},\"rows\":{}}}", json!(input.cursor()), types::encode_mode(input.mode(), Binding::Ipc), json!(input.note()), types::encode_page_rows(input.rows(), Binding::Ipc)));
        let (outcome, body) = configured(&self.reply, "batch", token).await.ok_or(HandlerFailure::Cancelled)?;
        match outcome.as_str() {
            "Done" => Ok(types::BatchSuccess::Done(fixture(types::decode_batch_done(&body, Binding::Ipc)))),
            "Empty" => Ok(types::BatchSuccess::Empty),
            "Refused" => Err(HandlerFailure::Rejected(types::BatchRejection::Refused(fixture(types::decode_batch_refused(&body, Binding::Ipc))))),
            _ => panic!("configured outcome is undeclared"),
        }
    }
}

/// Protocol observation of a lookup result
fn observe_lookup(result: Result<Accepted<types::LookupSuccess>, OperationFailure<types::LookupRejection>>) -> String {
    observe!(result,
        Ok(Accepted { value: types::LookupSuccess::Primary(v), diagnostics }) => ("success", "Primary", types::encode_lookup_primary(&v, Binding::Ipc), false, diagnostics),
        Ok(Accepted { value: types::LookupSuccess::Replica(v), diagnostics }) => ("success", "Replica", types::encode_lookup_replica(&v, Binding::Ipc), false, diagnostics),
        Err(OperationFailure::Rejected(Accepted { value: types::LookupRejection::Missing(v), diagnostics })) => ("rejected", "Missing", types::encode_lookup_missing(&v, Binding::Ipc), false, diagnostics),
        Err(OperationFailure::Rejected(Accepted { value: types::LookupRejection::Unavailable(v), diagnostics })) => ("rejected", "Unavailable", types::encode_lookup_unavailable(&v, Binding::Ipc), false, diagnostics),
    )
}

/// Protocol observation of a store result
fn observe_store(result: Result<Accepted<types::StoreSuccess>, OperationFailure<types::StoreRejection>>) -> String {
    observe!(result,
        Ok(Accepted { value: types::StoreSuccess::Stored, diagnostics }) => ("success", "Stored", "null".to_owned(), true, diagnostics),
        Err(OperationFailure::Rejected(Accepted { value: types::StoreRejection::Conflict(v), diagnostics })) => ("rejected", "Conflict", types::encode_store_conflict(&v, Binding::Ipc), false, diagnostics),
    )
}

/// Protocol observation of a batch result
fn observe_batch(result: Result<Accepted<types::BatchSuccess>, OperationFailure<types::BatchRejection>>) -> String {
    observe!(result,
        Ok(Accepted { value: types::BatchSuccess::Done(v), diagnostics }) => ("success", "Done", types::encode_batch_done(&v, Binding::Ipc), false, diagnostics),
        Ok(Accepted { value: types::BatchSuccess::Empty, diagnostics }) => ("success", "Empty", "null".to_owned(), true, diagnostics),
        Err(OperationFailure::Rejected(Accepted { value: types::BatchRejection::Refused(v), diagnostics })) => ("rejected", "Refused", types::encode_batch_refused(&v, Binding::Ipc), false, diagnostics),
    )
}

/// One operation call through the selected connection
pub async fn run(call: &Call) -> String {
    let (token, deadline) = (&call.token, call.deadline);
    match call.operation.as_str() {
        "lookup" => {
            let input = match types::decode_lookup_input(&call.parameters, call.wire()) { Ok(accepted) => accepted.value, Err(error) => return invalid(error) };
            match call.kind {
                Kind::Http => observe_lookup(client::lookup_http(call.http.as_ref().expect("HTTP transport"), input, token, deadline).await),
                Kind::Ipc => observe_lookup(client::lookup_ipc(call.ipc.as_ref().expect("IPC transport"), input, token, deadline).await),
                Kind::Direct => observe_lookup(provider::lookup_direct(&Adapter { reply: call.reply.clone() }, input, token, deadline).await),
            }
        }
        "store" => {
            let input = match types::decode_store_input(&call.parameters, call.wire()) { Ok(accepted) => accepted.value, Err(error) => return invalid(error) };
            match call.kind {
                Kind::Http => observe_store(client::store_http(call.http.as_ref().expect("HTTP transport"), input, token, deadline).await),
                Kind::Ipc => observe_store(client::store_ipc(call.ipc.as_ref().expect("IPC transport"), input, token, deadline).await),
                Kind::Direct => observe_store(provider::store_direct(&Adapter { reply: call.reply.clone() }, input, token, deadline).await),
            }
        }
        "batch" => {
            let input = match types::decode_batch_input(&call.parameters, call.wire()) { Ok(accepted) => accepted.value, Err(error) => return invalid(error) };
            match call.kind {
                Kind::Http => observe_batch(client::batch_http(call.http.as_ref().expect("HTTP transport"), input, token, deadline).await),
                Kind::Ipc => observe_batch(client::batch_ipc(call.ipc.as_ref().expect("IPC transport"), input, token, deadline).await),
                Kind::Direct => observe_batch(provider::batch_direct(&Adapter { reply: call.reply.clone() }, input, token, deadline).await),
            }
        }
        _ => panic!("fixture operation is undeclared"),
    }
}
