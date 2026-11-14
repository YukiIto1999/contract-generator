//! Real Wry webview host for generated TypeScript to Rust IPC acceptance
#![deny(warnings, unsafe_code)]

use serde_json::{Value, json};
use std::sync::{Mutex, atomic::{AtomicBool, Ordering}};
use tauri::{Manager, State};
use tokio::sync::Notify;
use transport::{CancellationToken, HandlerFailure, Instant, ProviderFailure};
use types::{Accepted, Binding, ValidationFailure};

/// Host request admission phase
#[derive(PartialEq)]
enum Phase { Starting, Ready, Stopping }

/// Observable effects of the test-only host operations
struct Effects {
    /// Admission authority
    phase: Phase,
    /// Most recently committed label
    label: String,
    /// Committed amount total
    total: i32,
    /// Completed writes
    writes: i32,
    /// Entered record handlers
    entered: i32,
    /// Currently held handlers
    active: i32,
    /// Handlers that completed cancellation cleanup
    cancelled: i32,
}

/// Composition-owned state shared by registered commands
struct Host {
    /// Host technical state
    effects: Mutex<Effects>,
    /// Event-driven acknowledgement of the held request
    held: Notify,
    /// Cancellation tree owned by this host
    token: CancellationToken,
    /// Successful webview report received before shutdown
    passed: AtomicBool,
}

impl Host {
    /// Initial host state without admitted operation requests
    ///
    /// - Return: starting host with no effects
    fn new() -> Self {
        Self {
            effects: Mutex::new(Effects { phase: Phase::Starting, label: String::new(), total: 0, writes: 0, entered: 0, active: 0, cancelled: 0 }),
            held: Notify::new(), token: CancellationToken::new(), passed: AtomicBool::new(false),
        }
    }

    /// Generated receipt of committed host state
    ///
    /// - self: composition-owned host
    /// - Return: immutable generated receipt
    /// # Panics
    /// Poisoned fixture state or invalid internally constructed receipt
    fn receipt(&self) -> types::Receipt {
        let effects = self.effects.lock().expect("fixture state lock");
        accepted(types::decode_inspect_inspected(&json!({"label": effects.label, "total": effects.total, "writes": effects.writes}).to_string(), Binding::Ipc))
    }
}

/// Accepted fixture-owned output through the generated payload completion
///
/// - value: generated decoding result for an internally composed payload
/// - Return: complete generated value
/// # Panics
/// Invalid internally constructed fixture value
fn accepted<T>(value: Result<Accepted<T>, ValidationFailure>) -> T {
    value.expect("fixture output must satisfy its contract").value
}

impl provider::Handler for Host {
    /// Test-only host write through the generated provider interface
    ///
    /// - self: composition-owned host
    /// - input: validated input after provider defaults
    /// - token: host cancellation tree
    /// - _deadline: forwarded deadline without a fixture timer
    /// - Return: committed receipt
    /// # Errors
    /// Declared refusal or cooperative cancellation after cleanup
    async fn record(&self, input: types::RecordAccepted, token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::RecordSuccess, HandlerFailure<types::RecordRejection>> {
        {
            let mut effects = self.effects.lock().expect("fixture state lock");
            effects.entered += 1;
        }
        if input.label() == "deny" {
            return Err(HandlerFailure::Rejected(types::RecordRejection::Refused(accepted(types::decode_record_refused("{\"code\":\"blocked\"}", Binding::Ipc)))));
        }
        if input.label() == "hold" {
            self.effects.lock().expect("fixture state lock").active += 1;
            self.held.notify_one();
            token.cancelled().await;
            let mut effects = self.effects.lock().expect("fixture state lock");
            effects.active -= 1;
            effects.cancelled += 1;
            return Err(HandlerFailure::Cancelled);
        }
        {
            let mut effects = self.effects.lock().expect("fixture state lock");
            effects.label = input.label().clone();
            effects.total += input.amount();
            effects.writes += 1;
        }
        Ok(types::RecordSuccess::Recorded(self.receipt()))
    }

    /// Generated inspection of the committed host state
    ///
    /// - self: composition-owned host
    /// - _input: generated empty inspection request
    /// - _token: original cancellation tree
    /// - _deadline: original host deadline
    /// - Return: current committed receipt
    /// # Errors
    /// No fixture-owned expected failures
    async fn inspect(&self, _input: types::InspectInput, _token: &CancellationToken, _deadline: Option<Instant>) -> Result<types::InspectSuccess, HandlerFailure<types::InspectRejection>> {
        Ok(types::InspectSuccess::Inspected(self.receipt()))
    }
}

/// Actual Tauri command reception through the generated JSON parser and dispatch
///
/// - host: composition-owned admission state
/// - command: generated binding command identifier
/// - parameters_json: exact serialized parameters from the generated TypeScript client
/// - Return: exact declared result envelope
/// # Errors
/// Host unavailability or typed provider failure without a successful envelope
#[tauri::command]
async fn contract_request(host: State<'_, Host>, command: String, parameters_json: String) -> Result<String, Value> {
    if host.effects.lock().expect("fixture state lock").phase != Phase::Ready {
        return Err(json!({"kind": "unavailable"}));
    }
    match provider::dispatch_ipc(&*host, &command, parameters_json, &host.token, None).await {
        Ok(value) => Ok(value.value),
        Err(ProviderFailure::InvalidInput(failure)) => Err(json!({"kind": "invalid-input", "violations": failure.violations})),
        Err(ProviderFailure::UnknownOperation) => Err(json!({"kind": "not-found"})),
        Err(ProviderFailure::Communication) => Err(json!({"kind": "communication"})),
        Err(ProviderFailure::Cancelled) => Err(json!({"kind": "cancelled"})),
    }
}

/// Fixture control plane for deterministic request admission and shutdown
///
/// - host: composition-owned lifecycle authority
/// - action: start or held-request acknowledgement or stop
/// - Return: control acknowledgement without operation data
/// # Errors
/// Unknown or out-of-order lifecycle action
#[tauri::command]
async fn lifecycle(host: State<'_, Host>, action: String) -> Result<(), String> {
    match action.as_str() {
        "start" => {
            let mut effects = host.effects.lock().expect("fixture state lock");
            if effects.phase != Phase::Starting { return Err("host already started".into()); }
            effects.phase = Phase::Ready;
        }
        "held" => host.held.notified().await,
        "stop" => {
            host.effects.lock().expect("fixture state lock").phase = Phase::Stopping;
            host.token.cancel();
        }
        _ => return Err("unknown lifecycle action".into()),
    }
    Ok(())
}

/// Webview scenario evidence checked against host-owned effects before shutdown
///
/// - app: real Wry application handle
/// - host: composition-owned state
/// - checks: independent scenario observations from the webview
/// - failure: failed assertion or uncaught viewer defect
/// - Return: host acceptance of the complete observation sequence
/// # Errors
/// Incomplete scenario or unexpected host state
#[tauri::command]
fn finish(app: tauri::AppHandle, host: State<'_, Host>, checks: Vec<String>, failure: Option<String>) -> Result<(), String> {
    let expected = ["not-ready", "provider-default", "explicit-input", "declared-rejection", "invalid-boundary", "unknown-command", "state-unchanged", "in-flight-cancelled", "stopped"];
    let effects = host.effects.lock().expect("fixture state lock");
    let valid = failure.is_none() && checks == expected && effects.phase == Phase::Stopping && effects.total == 5 && effects.writes == 2 && effects.entered == 4 && effects.active == 0 && effects.cancelled == 1;
    println!("{}", json!({"event": "webview-result", "checks": checks, "failure": failure, "passed": valid, "total": effects.total, "writes": effects.writes, "entered": effects.entered, "active": effects.active, "cancelled": effects.cancelled}));
    host.passed.store(valid, Ordering::SeqCst);
    if !valid {
        app.exit(1);
        return Err("webview scenario or host effects did not match".into());
    }
    if std::env::var("CONTRACT_GENERATOR_TAURI_OPEN").as_deref() != Ok("1") { app.exit(0); }
    Ok(())
}

/// Real Wry event loop with fail-closed reporting on normal window closure
fn main() {
    let app = tauri::Builder::<tauri::Wry>::new()
        .manage(Host::new())
        .invoke_handler(tauri::generate_handler![contract_request, lifecycle, finish])
        .build(tauri::generate_context!())
        .expect("real Wry host initialization");
    let exit = app.run_return(move |handle, event| {
        if let tauri::RunEvent::Exit = event {
            let passed = handle.state::<Host>().passed.load(Ordering::SeqCst);
            println!("{}", json!({"event": "host-exit", "passed": passed}));
        }
    });
    if exit != 0 { std::process::exit(exit); }
}
