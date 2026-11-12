//! Hand-written adapter and operation dispatch of the guarantees contract, spelled with the literal generated names
use crate::host::{Call, Kind, configured, fixture, invalid, record};
use crate::observe;
use serde_json::{Value, json};
use transport::{CancellationToken, HandlerFailure, Instant, OperationFailure};
use types::{Accepted, Binding};

/// Fixture-owned adapter with explicitly configured outcomes
pub struct Adapter {
    pub reply: Value,
}

/// Reply of the adapter for one operation, ending the call when cancelled during the configured delay
macro_rules! reply {
    ($self:ident, $name:literal, $token:ident, { $($outcome:literal => $result:expr),+ $(,)? }) => {{
        let (outcome, body) = configured(&$self.reply, $name, $token).await.ok_or(HandlerFailure::Cancelled)?;
        match outcome.as_str() { $($outcome => $result(body),)+ _ => panic!("configured outcome is undeclared") }
    }};
}

impl provider::Handler for Adapter {
    async fn configure(&self, input: types::ConfigureAccepted, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::ConfigureSuccess, HandlerFailure<types::ConfigureRejection>> {
        record("configure", json!({
            "settings": types::encode_settings_value(input.settings(), Binding::Ipc),
            "count": types::encode_ipc_count_value(input.count(), Binding::Ipc),
            "span": input.span(),
            "blob": types::encode_intrinsic_bytes_value(input.blob(), Binding::Ipc),
            "flag": types::encode_ipc_flag_value(input.flag(), Binding::Ipc),
        }));
        reply!(self, "configure", token, { "Done" => |body| Ok(types::ConfigureSuccess::Done(fixture(types::decode_configure_done(body, Binding::Ipc)))) })
    }

    async fn fetch(&self, _input: types::FetchInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::FetchSuccess, HandlerFailure<types::FetchRejection>> {
        record("fetch", json!({}));
        reply!(self, "fetch", token, { "Found" => |body| Ok(types::FetchSuccess::Found(fixture(types::decode_fetch_found(body, Binding::Ipc)))) })
    }

    async fn probe(&self, _input: types::ProbeInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::ProbeSuccess, HandlerFailure<types::ProbeRejection>> {
        record("probe", json!({}));
        reply!(self, "probe", token, {
            "Absent" => |_body| Ok(types::ProbeSuccess::Absent),
            "Present" => |body| Ok(types::ProbeSuccess::Present(fixture(types::decode_probe_present(body, Binding::Ipc)))),
        })
    }

    async fn grow(&self, input: types::GrowInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::GrowSuccess, HandlerFailure<types::GrowRejection>> {
        record("grow", json!({"tree": types::encode_tree_value(input.tree(), Binding::Ipc)}));
        reply!(self, "grow", token, { "Grown" => |body| Ok(types::GrowSuccess::Grown(fixture(types::decode_grow_grown(body, Binding::Ipc)))) })
    }

    async fn evaluate(&self, input: types::EvaluateInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::EvaluateSuccess, HandlerFailure<types::EvaluateRejection>> {
        record("evaluate", json!({"expr": types::encode_expr_value(input.expr(), Binding::Ipc)}));
        reply!(self, "evaluate", token, { "Evaluated" => |body| Ok(types::EvaluateSuccess::Evaluated(fixture(types::decode_evaluate_evaluated(body, Binding::Ipc)))) })
    }

    async fn note(&self, input: types::NoteInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::NoteSuccess, HandlerFailure<types::NoteRejection>> {
        record("note", json!({"text": input.text()}));
        reply!(self, "note", token, { "Noted" => |_body| Ok(types::NoteSuccess::Noted) })
    }

    async fn echo(&self, input: types::EchoInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::EchoSuccess, HandlerFailure<types::EchoRejection>> {
        record("echo", json!({"value": types::encode_exact_value(input.value(), Binding::Ipc)}));
        reply!(self, "echo", token, { "Echoed" => |body| Ok(types::EchoSuccess::Echoed(fixture(types::decode_echo_echoed(body, Binding::Ipc)))) })
    }
}

/// Protocol observation of a configure result
fn observe_configure(result: Result<Accepted<types::ConfigureSuccess>, OperationFailure<types::ConfigureRejection>>) -> Value {
    observe!(result, Ok(Accepted { value: types::ConfigureSuccess::Done(v), diagnostics }) => ("success", "Done", types::encode_configure_done(&v, Binding::Ipc), false, diagnostics))
}

/// Protocol observation of a fetch result
fn observe_fetch(result: Result<Accepted<types::FetchSuccess>, OperationFailure<types::FetchRejection>>) -> Value {
    observe!(result, Ok(Accepted { value: types::FetchSuccess::Found(v), diagnostics }) => ("success", "Found", types::encode_fetch_found(&v, Binding::Ipc), false, diagnostics))
}

/// Protocol observation of a probe result
fn observe_probe(result: Result<Accepted<types::ProbeSuccess>, OperationFailure<types::ProbeRejection>>) -> Value {
    observe!(result,
        Ok(Accepted { value: types::ProbeSuccess::Absent, diagnostics }) => ("success", "Absent", Value::Null, true, diagnostics),
        Ok(Accepted { value: types::ProbeSuccess::Present(v), diagnostics }) => ("success", "Present", types::encode_probe_present(&v, Binding::Ipc), false, diagnostics),
    )
}

/// Protocol observation of a grow result
fn observe_grow(result: Result<Accepted<types::GrowSuccess>, OperationFailure<types::GrowRejection>>) -> Value {
    observe!(result, Ok(Accepted { value: types::GrowSuccess::Grown(v), diagnostics }) => ("success", "Grown", types::encode_grow_grown(&v, Binding::Ipc), false, diagnostics))
}

/// Protocol observation of an evaluate result
fn observe_evaluate(result: Result<Accepted<types::EvaluateSuccess>, OperationFailure<types::EvaluateRejection>>) -> Value {
    observe!(result, Ok(Accepted { value: types::EvaluateSuccess::Evaluated(v), diagnostics }) => ("success", "Evaluated", types::encode_evaluate_evaluated(&v, Binding::Ipc), false, diagnostics))
}

/// Protocol observation of a note result
fn observe_note(result: Result<Accepted<types::NoteSuccess>, OperationFailure<types::NoteRejection>>) -> Value {
    observe!(result, Ok(Accepted { value: types::NoteSuccess::Noted, diagnostics }) => ("success", "Noted", Value::Null, true, diagnostics))
}

/// Protocol observation of an echo result
fn observe_echo(result: Result<Accepted<types::EchoSuccess>, OperationFailure<types::EchoRejection>>) -> Value {
    observe!(result, Ok(Accepted { value: types::EchoSuccess::Echoed(v), diagnostics }) => ("success", "Echoed", types::encode_echo_echoed(&v, Binding::Ipc), false, diagnostics))
}

/// Selected connection of one operation call
macro_rules! connect {
    ($call:ident, $observe:ident, $http:path, $ipc:path, $direct:path, $input:expr) => {
        match $call.kind {
            Kind::Http => $observe($http($call.http.as_ref().expect("HTTP transport"), $input, &$call.token, $call.deadline).await),
            Kind::Ipc => $observe($ipc($call.ipc.as_ref().expect("IPC transport"), $input, &$call.token, $call.deadline).await),
            Kind::Direct => $observe($direct(&Adapter { reply: $call.reply.clone() }, $input, &$call.token, $call.deadline).await),
        }
    };
}

/// One operation call through the selected connection
pub async fn run(call: &Call) -> Value {
    let wire = call.wire();
    let source = call.parameters.as_str();
    match call.operation.as_str() {
        "configure" => match types::decode_configure_input(source, wire) { Ok(a) => connect!(call, observe_configure, client::configure_http, client::configure_ipc, provider::configure_direct, a.value), Err(e) => invalid(e) },
        "fetch" => match types::decode_fetch_input(source, wire) { Ok(a) => connect!(call, observe_fetch, client::fetch_http, client::fetch_ipc, provider::fetch_direct, a.value), Err(e) => invalid(e) },
        "probe" => match types::decode_probe_input(source, wire) { Ok(a) => connect!(call, observe_probe, client::probe_http, client::probe_ipc, provider::probe_direct, a.value), Err(e) => invalid(e) },
        "grow" => match types::decode_grow_input(source, wire) { Ok(a) => connect!(call, observe_grow, client::grow_http, client::grow_ipc, provider::grow_direct, a.value), Err(e) => invalid(e) },
        "evaluate" => match types::decode_evaluate_input(source, wire) { Ok(a) => connect!(call, observe_evaluate, client::evaluate_http, client::evaluate_ipc, provider::evaluate_direct, a.value), Err(e) => invalid(e) },
        "note" => match types::decode_note_input(source, wire) { Ok(a) => connect!(call, observe_note, client::note_http, client::note_ipc, provider::note_direct, a.value), Err(e) => invalid(e) },
        "echo" => match types::decode_echo_input(source, wire) { Ok(a) => connect!(call, observe_echo, client::echo_http, client::echo_ipc, provider::echo_direct, a.value), Err(e) => invalid(e) },
        _ => panic!("fixture operation is undeclared"),
    }
}
