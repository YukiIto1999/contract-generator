//! Test-only host: the actual process IPC transport, the host-owned HTTP deadline, typed-result rendering and call setup
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use transport::{CancellationToken, CommunicationFailure, Instant, IpcTransport, ProviderFailure};

/// Owned child process connection with serialized request correlation
struct ProcessState {
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::io::Lines<tokio::io::BufReader<tokio::process::ChildStdout>>,
}

/// Actual separately spawned IPC provider transport that enforces the forwarded deadline itself
pub struct ProcessTransport {
    state: tokio::sync::Mutex<ProcessState>,
}

impl ProcessTransport {
    /// Native provider process startup with an explicit adapter reply configuration
    pub async fn start(reply: &Value) -> Self {
        let mut child = tokio::process::Command::new(std::env::current_exe().expect("fixture executable"))
            .arg("ipc-provider")
            .arg("-")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .expect("separate IPC provider");
        let mut stdin = child.stdin.take().expect("provider stdin");
        stdin.write_all(format!("{reply}\n").as_bytes()).await.expect("provider configuration");
        stdin.flush().await.expect("provider configuration flush");
        let stdout = child.stdout.take().expect("provider stdout");
        let stdout = tokio::io::BufReader::new(stdout).lines();
        Self { state: tokio::sync::Mutex::new(ProcessState { child, stdin, stdout }) }
    }

    /// Explicit child termination and reaping
    pub async fn close(&self) {
        let mut state = self.state.lock().await;
        let _ = state.child.kill().await;
        let _ = state.child.wait().await;
    }
}

impl IpcTransport for ProcessTransport {
    async fn invoke(&self, command: &str, parameters: String, token: &CancellationToken, deadline: Option<Instant>) -> Result<String, CommunicationFailure> {
        if token.is_cancelled() {
            return Err(CommunicationFailure::Cancelled);
        }
        let mut state = self.state.lock().await;
        let outcome = {
            let work = async {
                let line = format!("{}\n", json!({"command": command, "parameters": parameters}));
                state.stdin.write_all(line.as_bytes()).await.map_err(|_| CommunicationFailure::Failed)?;
                state.stdin.flush().await.map_err(|_| CommunicationFailure::Failed)?;
                let line = state.stdout.next_line().await.map_err(|_| CommunicationFailure::Failed)?.ok_or(CommunicationFailure::Failed)?;
                Ok(line)
            };
            let timer = async {
                match deadline {
                    Some(deadline) => tokio::time::sleep_until(deadline).await,
                    None => std::future::pending().await,
                }
            };
            tokio::select! { biased; result = work => Some(result), () = token.cancelled() => None, () = timer => None }
        };
        match outcome {
            Some(result) => result,
            None => {
                let _ = state.child.kill().await;
                let _ = state.child.wait().await;
                Err(if token.is_cancelled() { CommunicationFailure::Cancelled } else { CommunicationFailure::DeadlineExceeded })
            }
        }
    }
}

/// Host-owned HTTP deadline boundary around the bundled transport
pub struct HostHttp(pub client::ReqwestTransport);

impl client::HttpTransport for HostHttp {
    fn origin(&self) -> &reqwest::Url {
        client::HttpTransport::origin(&self.0)
    }

    async fn send(&self, request: reqwest::Request, token: &CancellationToken, deadline: Option<Instant>) -> Result<client::HttpResponse, CommunicationFailure> {
        eprintln!("{}", json!({"sent": {"method": request.method().as_str(), "url": request.url().as_str()}}));
        let Some(deadline) = deadline else {
            return client::HttpTransport::send(&self.0, request, token, None).await;
        };
        match tokio::time::timeout_at(deadline, client::HttpTransport::send(&self.0, request, token, Some(deadline))).await {
            Ok(result) => result,
            Err(_) if token.is_cancelled() => Err(CommunicationFailure::Cancelled),
            Err(_) => Err(CommunicationFailure::DeadlineExceeded),
        }
    }
}

/// Typed provider result rendered as the host's own JSON; the generated provider never answers these cases
pub fn failure_json(failure: &ProviderFailure) -> Value {
    match failure {
        ProviderFailure::InvalidInput(error) => json!({"failure": "invalidInput", "violations": error.violations, "diagnostics": error.diagnostics}),
        ProviderFailure::UnknownOperation => json!({"failure": "unknownOperation"}),
        ProviderFailure::Communication => json!({"failure": "communication"}),
        ProviderFailure::Cancelled => json!({"failure": "cancelled"}),
    }
}

/// HTTP response policy of the fixture host for a typed provider result
pub fn failure_response(failure: &ProviderFailure) -> axum::response::Response {
    if let ProviderFailure::InvalidInput(error) = failure {
        if !error.diagnostics.is_empty() {
            eprintln!("{}", json!({"diagnostics": error.diagnostics}));
        }
    }
    let status = match failure {
        ProviderFailure::InvalidInput(_) => 400,
        ProviderFailure::UnknownOperation => 404,
        ProviderFailure::Communication => 503,
        ProviderFailure::Cancelled => 499,
    };
    axum::response::Response::builder()
        .status(status)
        .header("content-type", "application/problem+json")
        .body(axum::body::Body::from(failure_json(failure).to_string()))
        .expect("fixture failure response")
}

/// How one call reaches the generated operation
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    Http,
    Ipc,
    Direct,
}

/// One driver call with its host-owned cancellation, deadline and transports
pub struct Call {
    pub operation: String,
    pub parameters: String,
    pub kind: Kind,
    pub token: CancellationToken,
    pub deadline: Option<Instant>,
    pub http: Option<HostHttp>,
    pub ipc: Option<ProcessTransport>,
    pub reply: Value,
    cancel_after_result: bool,
}

impl Call {
    /// Call setup from the explicit JSON-line command
    pub async fn open(request: &Value, token: CancellationToken) -> Self {
        if request["cancelBefore"] == true {
            token.cancel();
        }
        let deadline = request["deadlineMs"].as_u64().map(|delay| Instant::now() + std::time::Duration::from_millis(delay));
        let kind = match request["binding"].as_str() {
            Some("http") => Kind::Http,
            Some("ipc") => Kind::Ipc,
            _ => Kind::Direct,
        };
        let ipc = if kind == Kind::Ipc { Some(ProcessTransport::start(&request["reply"]).await) } else { None };
        let http = if kind == Kind::Http {
            let origin = request["origin"].as_str().expect("fixture origin").parse().expect("native URL");
            Some(HostHttp(client::ReqwestTransport::new(reqwest::Client::builder(), origin).expect("native client")))
        } else {
            None
        };
        Self {
            operation: request["operation"].as_str().expect("fixture operation").to_owned(),
            parameters: request["parameters"].as_str().expect("raw parameters").to_owned(),
            kind,
            token,
            deadline,
            http,
            ipc,
            reply: request["reply"].clone(),
            cancel_after_result: request["cancelAfterResult"] == true,
        }
    }

    /// Wire interpretation the client input is decoded with
    pub fn wire(&self) -> types::Binding {
        if self.kind == Kind::Http { types::Binding::Http } else { types::Binding::Ipc }
    }

    /// Host cancellation raised only after the call future returned its result, when the call asks for it, and child cleanup
    pub async fn finish(self) {
        if self.cancel_after_result {
            self.token.cancel();
        }
        if let Some(ipc) = &self.ipc {
            ipc.close().await;
        }
    }
}

/// Observation of a rejected client input before any call
pub fn invalid(error: types::ValidationFailure) -> String {
    json!({"kind": "invalidInput", "violations": error.violations, "diagnostics": error.diagnostics}).to_string()
}

/// Observation of a client result as protocol JSON: each arm yields kind, outcome, body, void flag and diagnostics
#[macro_export]
macro_rules! observe {
    ($result:expr, $($pattern:pat => $observation:expr),+ $(,)?) => {
        match $result {
            $($pattern => {
                let (kind, outcome, body, void, diagnostics): (&str, &str, String, bool, Vec<types::Diagnostic>) = $observation;
                format!("{{\"kind\":{},\"outcome\":{},\"body\":{},\"void\":{},\"diagnostics\":{}}}", serde_json::to_string(kind).expect("fixture kind"), serde_json::to_string(outcome).expect("fixture outcome"), body, void, serde_json::to_string(&diagnostics).expect("fixture diagnostics"))
            })+
            Err(transport::OperationFailure::Communication) => String::from("{\"kind\":\"communication\"}"),
            Err(transport::OperationFailure::Cancelled) => String::from("{\"kind\":\"cancelled\"}"),
            Err(transport::OperationFailure::DeadlineExceeded) => String::from("{\"kind\":\"deadlineExceeded\"}"),
        }
    };
}

/// Adapter reply for one operation; a held reply never answers and ends only by cancellation, which yields none
pub async fn configured(reply: &Value, operation: &str, token: &CancellationToken) -> Option<(String, String)> {
    if reply["hold"] == true {
        token.cancelled().await;
        return None;
    }
    let reply = reply.get(operation).unwrap_or(reply);
    Some((reply["outcome"].as_str().expect("explicit configured outcome").to_owned(), reply["bodyJson"].as_str().map(str::to_owned).unwrap_or_else(|| reply["body"].to_string())))
}

/// Adapter acceptance observation on stderr, separate from the response protocol
pub fn record(operation: &str, accepted: String) {
    eprintln!("{{\"operation\":{},\"accepted\":{}}}", serde_json::to_string(operation).expect("fixture operation"), accepted);
}

/// Value from a generated codec that the configured fixture response must satisfy
pub fn fixture<T>(decoded: Result<types::Accepted<T>, types::ValidationFailure>) -> T {
    decoded.expect("fixture response must satisfy the generated codec").value
}
