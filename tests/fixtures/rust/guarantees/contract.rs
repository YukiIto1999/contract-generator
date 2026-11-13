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
        match outcome.as_str() { $($outcome => $result(body.as_str()),)+ _ => panic!("configured outcome is undeclared") }
    }};
}

impl provider::Handler for Adapter {
    async fn configure(&self, input: types::ConfigureAccepted, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::ConfigureSuccess, HandlerFailure<types::ConfigureRejection>> {
        record("configure", format!("{{\"settings\":{},\"count\":{},\"span\":{},\"blob\":{},\"flag\":{}}}", types::encode_settings(input.settings(), Binding::Ipc), types::encode_ipc_count(input.count(), Binding::Ipc), json!(input.span()), types::encode_intrinsic_bytes(input.blob(), Binding::Ipc), types::encode_ipc_flag(input.flag(), Binding::Ipc)));
        reply!(self, "configure", token, { "Done" => |body| Ok(types::ConfigureSuccess::Done(fixture(types::decode_configure_done(body, Binding::Ipc)))) })
    }

    async fn fetch(&self, _input: types::FetchInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::FetchSuccess, HandlerFailure<types::FetchRejection>> {
        record("fetch", "{}".to_owned());
        reply!(self, "fetch", token, { "Found" => |body| Ok(types::FetchSuccess::Found(fixture(types::decode_fetch_found(body, Binding::Ipc)))) })
    }

    async fn probe(&self, _input: types::ProbeInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::ProbeSuccess, HandlerFailure<types::ProbeRejection>> {
        record("probe", "{}".to_owned());
        reply!(self, "probe", token, {
            "Absent" => |_body| Ok(types::ProbeSuccess::Absent),
            "Present" => |body| Ok(types::ProbeSuccess::Present(fixture(types::decode_probe_present(body, Binding::Ipc)))),
        })
    }

    async fn grow(&self, input: types::GrowInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::GrowSuccess, HandlerFailure<types::GrowRejection>> {
        record("grow", types::encode_grow_input(&input, Binding::Ipc));
        reply!(self, "grow", token, { "Grown" => |body| Ok(types::GrowSuccess::Grown(fixture(types::decode_grow_grown(body, Binding::Ipc)))) })
    }

    async fn evaluate(&self, input: types::EvaluateInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::EvaluateSuccess, HandlerFailure<types::EvaluateRejection>> {
        record("evaluate", types::encode_evaluate_input(&input, Binding::Ipc));
        reply!(self, "evaluate", token, { "Evaluated" => |body| Ok(types::EvaluateSuccess::Evaluated(fixture(types::decode_evaluate_evaluated(body, Binding::Ipc)))) })
    }

    async fn note(&self, input: types::NoteInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::NoteSuccess, HandlerFailure<types::NoteRejection>> {
        record("note", types::encode_note_input(&input, Binding::Ipc));
        reply!(self, "note", token, { "Noted" => |_body| Ok(types::NoteSuccess::Noted) })
    }

    async fn archive(&self, input: types::ArchiveInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::ArchiveSuccess, HandlerFailure<types::ArchiveRejection>> {
        record("archive", types::encode_archive_input(&input, Binding::Ipc));
        reply!(self, "archive", token, { "Archived" => |_body| Ok(types::ArchiveSuccess::Archived) })
    }

    async fn echo(&self, input: types::EchoInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::EchoSuccess, HandlerFailure<types::EchoRejection>> {
        record("echo", types::encode_echo_input(&input, Binding::Ipc));
        reply!(self, "echo", token, { "Echoed" => |body| Ok(types::EchoSuccess::Echoed(fixture(types::decode_echo_echoed(body, Binding::Ipc)))) })
    }

    async fn normalize(&self, input: types::NormalizeInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::NormalizeSuccess, HandlerFailure<types::NormalizeRejection>> {
        record("normalize", types::encode_normalize_input(&input, Binding::Ipc));
        reply!(self, "normalize", token, { "Normalized" => |body| Ok(types::NormalizeSuccess::Normalized(fixture(types::decode_normalize_normalized(body, Binding::Ipc)))) })
    }

    async fn topology(&self, input: types::TopologyInput, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::TopologySuccess, HandlerFailure<types::TopologyRejection>> {
        record("topology", types::encode_topology_input(&input, Binding::Ipc));
        reply!(self, "topology", token, { "Inspected" => |_body| Ok(types::TopologySuccess::Inspected) })
    }
}

/// Protocol observation of a configure result
fn observe_configure(result: Result<Accepted<types::ConfigureSuccess>, OperationFailure<types::ConfigureRejection>>) -> String {
    observe!(result, Ok(Accepted { value: types::ConfigureSuccess::Done(v), diagnostics }) => ("success", "Done", types::encode_configure_done(&v, Binding::Ipc), false, diagnostics))
}

/// Protocol observation of a fetch result
fn observe_fetch(result: Result<Accepted<types::FetchSuccess>, OperationFailure<types::FetchRejection>>) -> String {
    observe!(result, Ok(Accepted { value: types::FetchSuccess::Found(v), diagnostics }) => ("success", "Found", types::encode_fetch_found(&v, Binding::Ipc), false, diagnostics))
}

/// Protocol observation of a probe result
fn observe_probe(result: Result<Accepted<types::ProbeSuccess>, OperationFailure<types::ProbeRejection>>) -> String {
    observe!(result,
        Ok(Accepted { value: types::ProbeSuccess::Absent, diagnostics }) => ("success", "Absent", "null".to_owned(), true, diagnostics),
        Ok(Accepted { value: types::ProbeSuccess::Present(v), diagnostics }) => ("success", "Present", types::encode_probe_present(&v, Binding::Ipc), false, diagnostics),
    )
}

/// Protocol observation of a grow result
fn observe_grow(result: Result<Accepted<types::GrowSuccess>, OperationFailure<types::GrowRejection>>) -> String {
    observe!(result, Ok(Accepted { value: types::GrowSuccess::Grown(v), diagnostics }) => ("success", "Grown", types::encode_grow_grown(&v, Binding::Ipc), false, diagnostics))
}

/// Protocol observation of an evaluate result
fn observe_evaluate(result: Result<Accepted<types::EvaluateSuccess>, OperationFailure<types::EvaluateRejection>>) -> String {
    observe!(result, Ok(Accepted { value: types::EvaluateSuccess::Evaluated(v), diagnostics }) => ("success", "Evaluated", types::encode_evaluate_evaluated(&v, Binding::Ipc), false, diagnostics))
}

/// Protocol observation of a note result
fn observe_note(result: Result<Accepted<types::NoteSuccess>, OperationFailure<types::NoteRejection>>) -> String {
    observe!(result, Ok(Accepted { value: types::NoteSuccess::Noted, diagnostics }) => ("success", "Noted", "null".to_owned(), true, diagnostics))
}

/// Protocol observation of an archive result
fn observe_archive(result: Result<Accepted<types::ArchiveSuccess>, OperationFailure<types::ArchiveRejection>>) -> String {
    observe!(result, Ok(Accepted { value: types::ArchiveSuccess::Archived, diagnostics }) => ("success", "Archived", "null".to_owned(), true, diagnostics))
}

/// Protocol observation of an echo result
fn observe_echo(result: Result<Accepted<types::EchoSuccess>, OperationFailure<types::EchoRejection>>) -> String {
    observe!(result, Ok(Accepted { value: types::EchoSuccess::Echoed(v), diagnostics }) => ("success", "Echoed", types::encode_echo_echoed(&v, Binding::Ipc), false, diagnostics))
}

fn observe_normalize(result: Result<Accepted<types::NormalizeSuccess>, OperationFailure<types::NormalizeRejection>>) -> String {
    observe!(result, Ok(Accepted { value: types::NormalizeSuccess::Normalized(v), diagnostics }) => ("success", "Normalized", types::encode_normalize_normalized(&v, Binding::Ipc), false, diagnostics))
}

fn observe_topology(result: Result<Accepted<types::TopologySuccess>, OperationFailure<types::TopologyRejection>>) -> String {
    observe!(result, Ok(Accepted { value: types::TopologySuccess::Inspected, diagnostics }) => ("success", "Inspected", "null".to_owned(), true, diagnostics))
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
pub async fn run(call: &Call) -> String {
    let wire = call.wire();
    let source = call.parameters.as_str();
    match call.operation.as_str() {
        "configure" => match types::decode_configure_input(source, wire) { Ok(a) => connect!(call, observe_configure, client::configure_http, client::configure_ipc, provider::configure_direct, a.value), Err(e) => invalid(e) },
        "fetch" => match types::decode_fetch_input(source, wire) { Ok(a) => connect!(call, observe_fetch, client::fetch_http, client::fetch_ipc, provider::fetch_direct, a.value), Err(e) => invalid(e) },
        "probe" => match types::decode_probe_input(source, wire) { Ok(a) => connect!(call, observe_probe, client::probe_http, client::probe_ipc, provider::probe_direct, a.value), Err(e) => invalid(e) },
        "grow" => match types::decode_grow_input(source, wire) { Ok(a) => connect!(call, observe_grow, client::grow_http, client::grow_ipc, provider::grow_direct, a.value), Err(e) => invalid(e) },
        "evaluate" => match types::decode_evaluate_input(source, wire) { Ok(a) => connect!(call, observe_evaluate, client::evaluate_http, client::evaluate_ipc, provider::evaluate_direct, a.value), Err(e) => invalid(e) },
        "note" => match types::decode_note_input(source, wire) { Ok(a) => connect!(call, observe_note, client::note_http, client::note_ipc, provider::note_direct, a.value), Err(e) => invalid(e) },
        "archive" => match types::decode_archive_input(source, wire) { Ok(a) => connect!(call, observe_archive, client::archive_http, client::archive_ipc, provider::archive_direct, a.value), Err(e) => invalid(e) },
        "echo" => match types::decode_echo_input(source, wire) { Ok(a) => connect!(call, observe_echo, client::echo_http, client::echo_ipc, provider::echo_direct, a.value), Err(e) => invalid(e) },
        "normalize" => match types::decode_normalize_input(source, wire) { Ok(a) => connect!(call, observe_normalize, client::normalize_http, client::normalize_ipc, provider::normalize_direct, a.value), Err(e) => invalid(e) },
        "topology" => match types::decode_topology_input(source, wire) { Ok(a) => connect!(call, observe_topology, client::topology_http, client::topology_ipc, provider::topology_direct, a.value), Err(e) => invalid(e) },
        _ => panic!("fixture operation is undeclared"),
    }
}
