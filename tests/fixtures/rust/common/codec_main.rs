//! Test-only public-codec driver without an HTTP or async dependency
mod codec;

use serde_json::Value;
use std::io::{BufRead, Write};

/// Streaming fixture protocol entry point: one codec observation line per command line
fn main() {
    let stdout = std::io::stdout();
    let mut output = stdout.lock();
    for line in std::io::stdin().lock().lines() {
        let request: Value = serde_json::from_str(&line.expect("input line")).expect("fixture command JSON");
        let binding = if request["binding"] == "http" { types::Binding::Http } else { types::Binding::Ipc };
        let name = request["type"].as_str().expect("fixture type");
        let source = request["payload"].as_str().expect("fixture payload string");
        writeln!(output, "{}", codec::observe(name, source, binding)).expect("fixture output");
        output.flush().expect("fixture flush");
    }
}
