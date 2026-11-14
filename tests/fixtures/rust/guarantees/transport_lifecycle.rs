use serde_json::json;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use transport::{CancellationToken, CommunicationFailure, Instant, IpcTransport};
use types::{Binding, GrowSuccess};

const DEPTH: usize = 20_000;

fn deep_tree() -> String {
    let mut text = String::new();
    for _ in 0..DEPTH { text.push_str(r#"{"label":"branch","children":[],"child":"#); }
    text.push_str(r#"{"label":"leaf","children":[]}"#);
    for _ in 0..DEPTH { text.push('}'); }
    text
}

fn assert_leaf(tree: &types::Tree) {
    let mut node = tree;
    let mut count = 0;
    while let Some(Some(child)) = node.child() { node = child; count += 1; }
    assert_eq!(node.label(), "leaf");
    assert_eq!(count, DEPTH);
}

fn deep_expr() -> String {
    let mut text = String::new();
    for _ in 0..DEPTH { text.push_str(r#"{"kind":"add","left":"#); }
    text.push_str(r#"{"kind":"num","value":7}"#);
    for _ in 0..DEPTH { text.push_str(r#","right":{"kind":"num","value":1}}"#); }
    text
}

fn assert_expr(mut value: &types::Expr) {
    let mut count = 0;
    loop {
        match value.as_case() {
            types::ExprCase::Num(leaf) => { assert_eq!(*leaf.value(), 7); break; }
            types::ExprCase::Add(branch) => { value = branch.left(); count += 1; }
        }
    }
    assert_eq!(count, DEPTH);
}

async fn provider(mode: &str, body: &str) -> (tokio::process::Child, tokio::process::ChildStdin, tokio::io::Lines<tokio::io::BufReader<tokio::process::ChildStdout>>) {
    let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_guarantees-fixture-driver"))
        .args([mode, "-"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .kill_on_drop(true).spawn().expect("real provider process");
    let mut input = child.stdin.take().expect("provider stdin");
    let output = tokio::io::BufReader::new(child.stdout.take().expect("provider stdout")).lines();
    let configuration = json!({"grow":{"outcome":"Grown", "bodyJson":body}, "evaluate":{"outcome":"Evaluated", "bodyJson":deep_expr()}}).to_string();
    input.write_all(configuration.as_bytes()).await.expect("provider configuration");
    input.write_all(b"\n").await.expect("configuration delimiter");
    input.flush().await.expect("configuration flush");
    (child, input, output)
}

struct Process {
    io: tokio::sync::Mutex<(tokio::process::ChildStdin, tokio::io::Lines<tokio::io::BufReader<tokio::process::ChildStdout>>)>,
}

impl IpcTransport for Process {
    async fn invoke(&self, command: &str, parameters: String, token: &CancellationToken, _deadline: Option<Instant>) -> Result<String, CommunicationFailure> {
        if token.is_cancelled() { return Err(CommunicationFailure::Cancelled); }
        let mut io = self.io.lock().await;
        let request = json!({"command":command,"parameters":parameters}).to_string();
        io.0.write_all(request.as_bytes()).await.map_err(|_| CommunicationFailure::Failed)?;
        io.0.write_all(b"\n").await.map_err(|_| CommunicationFailure::Failed)?;
        io.0.flush().await.map_err(|_| CommunicationFailure::Failed)?;
        io.1.next_line().await.map_err(|_| CommunicationFailure::Failed)?.ok_or(CommunicationFailure::Failed)
    }
}

#[tokio::test]
async fn real_ipc_string_envelopes_carry_deep_typed_values() {
    let tree = deep_tree();
    let (mut child, input, output) = provider("ipc-provider", &tree).await;
    let transport = Process { io: tokio::sync::Mutex::new((input, output)) };
    let source = format!(r#"{{"tree":{tree}}}"#);
    let input = types::decode_grow_input(&source, Binding::Ipc).expect("deep native input").value;
    let result = client::grow_ipc(&transport, input, &CancellationToken::new(), None).await.expect("actual IPC exchange");
    let GrowSuccess::Grown(value) = result.value;
    assert!(result.diagnostics.is_empty());
    assert_leaf(&value);
    let encoded = types::encode_tree(&value, Binding::Ipc);
    let decoded = types::decode_tree(&encoded, Binding::Ipc).expect("returned payload").value;
    assert_eq!(decoded, value);
    let source = format!(r#"{{"expr":{}}}"#, deep_expr());
    let expression = types::decode_evaluate_input(&source, Binding::Ipc).expect("deep union IPC input").value;
    let result = client::evaluate_ipc(&transport, expression, &CancellationToken::new(), None).await.expect("actual union IPC exchange");
    let types::EvaluateSuccess::Evaluated(expression) = result.value;
    assert!(result.diagnostics.is_empty());
    assert_expr(&expression);
    drop(expression);
    drop((decoded, value));
    child.kill().await.expect("provider shutdown");
    child.wait().await.expect("provider reap");
    drop(transport);
}

#[tokio::test]
async fn real_http_envelopes_carry_deep_typed_values_and_reject_invalid_utf8() {
    let tree = deep_tree();
    let (mut child, input, mut output) = provider("http-provider", &tree).await;
    let ready = output.next_line().await.expect("provider startup").expect("provider address");
    let ready: serde_json::Value = serde_json::from_str(&ready).expect("shallow address envelope");
    let port = ready["port"].as_u64().expect("port");
    let origin = format!("http://127.0.0.1:{port}/");
    let http = reqwest::Client::new();
    let transport = client::ReqwestTransport::new(reqwest::Client::builder(), origin.parse().expect("provider URL")).expect("native client");
    let source = format!(r#"{{"tree":{tree}}}"#);
    let typed = types::decode_grow_input(&source, Binding::Http).expect("deep HTTP input").value;
    let result = client::grow_http(&transport, typed, &CancellationToken::new(), None).await.expect("actual HTTP exchange");
    let GrowSuccess::Grown(value) = result.value;
    assert!(result.diagnostics.is_empty());
    assert_leaf(&value);
    assert_eq!(types::decode_tree(&types::encode_tree(&value, Binding::Http), Binding::Http).expect("HTTP return payload").value, value);
    let source = format!(r#"{{"expr":{}}}"#, deep_expr());
    let expression = types::decode_evaluate_input(&source, Binding::Http).expect("deep union HTTP input").value;
    let result = client::evaluate_http(&transport, expression, &CancellationToken::new(), None).await.expect("actual union HTTP exchange");
    let types::EvaluateSuccess::Evaluated(expression) = result.value;
    assert!(result.diagnostics.is_empty());
    assert_expr(&expression);
    drop(expression);
    let invalid = http.post(format!("{origin}grow")).header("content-type", "application/json").body(b"{\"tree\":{\"label\":\"\xff\",\"children\":[]}}".to_vec()).send().await.expect("invalid UTF8 reaches provider");
    assert_eq!(invalid.status().as_u16(), 400);
    drop((value, transport, input));
    child.kill().await.expect("provider shutdown");
    child.wait().await.expect("provider reap");
}
