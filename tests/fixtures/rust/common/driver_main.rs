//! Test-only actual HTTP and separate-process IPC driver
mod contract;
mod host;

use serde_json::{Value, json};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use transport::CancellationToken;

/// Generated client or provider invocation without fixture-side wire classification
async fn invoke(request: Value, token: CancellationToken) -> Value {
    let call = host::Call::open(&request, token).await;
    let result = contract::run(&call).await;
    call.finish().await;
    result
}

/// Real loopback HTTP listener whose requests go to the generated dispatcher and whose typed failures the host renders
async fn http_provider(reply: Value) {
    let adapter = Arc::new(contract::Adapter { reply });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("real loopback listener");
    println!("{}", json!({"port": listener.local_addr().expect("bound address").port()}));
    let app = axum::Router::new().fallback(move |request: axum::http::Request<axum::body::Body>| {
        let adapter = adapter.clone();
        async move {
            match provider::dispatch_http(adapter.as_ref(), request, &CancellationToken::new(), None).await {
                Ok(accepted) => {
                    if !accepted.diagnostics.is_empty() {
                        eprintln!("{}", json!({"diagnostics": accepted.diagnostics}));
                    }
                    accepted.value
                }
                Err(failure) => host::failure_response(&failure),
            }
        }
    });
    axum::serve(listener, app).await.expect("real HTTP provider");
}

/// Line protocol over stdio whose commands go to the generated IPC dispatcher
async fn ipc_provider(reply: Value) {
    let handler = contract::Adapter { reply };
    let token = CancellationToken::new();
    let mut input = tokio::io::BufReader::new(tokio::io::stdin()).lines();
    let mut output = tokio::io::stdout();
    while let Some(line) = input.next_line().await.expect("native IPC request") {
        let mut request: Value = types::parse_json(&line).expect("IPC request JSON");
        let command = request["command"].as_str().expect("native command").to_owned();
        let parameters = request["parameters"].take();
        let text = match provider::dispatch_ipc(&handler, &command, parameters, &token, None).await {
            Ok(accepted) => accepted.value.to_string(),
            Err(failure) => host::failure_json(&failure).to_string(),
        };
        output.write_all(format!("{text}\n").as_bytes()).await.expect("IPC native result");
        output.flush().await.expect("IPC flush");
    }
}

/// Command lines read from the host while a call is in flight
type Commands = tokio::io::Lines<tokio::io::BufReader<tokio::io::Stdin>>;

/// Observation of one invocation task; a panic in generated or fixture code is a contract defect
fn observed(outcome: Result<Value, tokio::task::JoinError>) -> Value {
    match outcome {
        Ok(result) => result,
        Err(error) if error.is_panic() => json!({"kind": "defect"}),
        Err(_) => panic!("fixture task cancellation"),
    }
}

/// One call whose host cancellation is raised by a `{"cancel":true}` line arriving on the call protocol while it runs
async fn cancellable(request: Value, commands: &mut Commands) -> Value {
    let token = CancellationToken::new();
    let mut task = tokio::spawn(invoke(request, token.clone()));
    let mut reading = true;
    loop {
        tokio::select! {
            outcome = &mut task => return observed(outcome),
            line = commands.next_line(), if reading => match line.expect("fixture cancel") {
                Some(text) => {
                    let command: Value = serde_json::from_str(&text).expect("fixture cancel JSON");
                    if command["cancel"] == true {
                        token.cancel();
                    }
                }
                None => reading = false,
            },
        }
    }
}

/// JSON-line call protocol: one observation line per command
async fn calls() {
    let mut input = tokio::io::BufReader::new(tokio::io::stdin()).lines();
    let mut output = tokio::io::stdout();
    while let Some(line) = input.next_line().await.expect("fixture call") {
        let request: Value = serde_json::from_str(&line).expect("fixture call JSON");
        let result = cancellable(request, &mut input).await;
        output.write_all(format!("{result}\n").as_bytes()).await.expect("fixture result");
        output.flush().await.expect("fixture flush");
    }
}

/// Native driver mode dispatch
#[tokio::main]
async fn main() {
    let mut args = std::env::args().skip(1);
    let mode = args.next();
    let reply = args.next().map(|text| serde_json::from_str(&text).expect("reply JSON")).unwrap_or(Value::Null);
    match mode.as_deref() {
        Some("http-provider") => http_provider(reply).await,
        Some("ipc-provider") => ipc_provider(reply).await,
        Some("call") => calls().await,
        _ => panic!("expected http-provider, ipc-provider or call mode"),
    }
}
