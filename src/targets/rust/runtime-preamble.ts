/** Public codec vocabulary that every generated types crate exposes */
export const typesPreamble = String.raw`//! Validated contract values with owned immutable graphs
use serde_json::Number;

/// Transport-local wire interpretation
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Binding {
    /// HTTP request and response representation
    Http,
    /// Host-supplied IPC message representation
    Ipc,
}
/// Accepted boundary value with unknown-key observations
#[derive(Debug, Clone, PartialEq)]
pub struct Accepted<T> {
    /// Complete validated value
    pub value: T,
    /// Unknown key names without retained values
    pub diagnostics: Vec<Diagnostic>,
}
/// Unknown object member observation
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Diagnostic {
    /// RFC 6901 pointer of the object that contains the unknown member
    pub path: String,
    /// Unknown member name
    pub key: String,
}
/// Normal input rejection with a semantic rule identifier
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Violation {
    /// RFC 6901 rejected location
    pub path: String,
    /// Stable semantic rule identifier
    pub rule: String,
}
/// Complete rejection without a partially validated value
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, thiserror::Error)]
#[error("contract input validation failed")]
pub struct ValidationFailure {
    /// Known-member violations
    pub violations: Vec<Violation>,
    /// Unknown member observations
    pub diagnostics: Vec<Diagnostic>,
}
/// Exact JSON numeric token with arbitrary precision
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExactNumber(Number);
impl ExactNumber {
    /// Construction from an exact JSON numeric spelling
    ///
    /// - text: JSON numeric source
    /// - Return: validated exact numeric value
    /// # Errors
    /// Non-numeric JSON or malformed source
    pub fn try_new(text: &str) -> Result<Self, ValidationFailure> {
        if valid_number(text) { Ok(Self(Number::from_string_unchecked(text.into()))) } else { Err(number_failure()) }
    }
    /// Borrowed exact lexical representation
    ///
    /// - self: validated number
    /// - Return: original JSON numeric spelling
    pub fn as_str(&self) -> &str { self.0.as_str() }
}
/// Exact-number construction rejection for a non-numeric or malformed token
fn number_failure() -> ValidationFailure { ValidationFailure { violations: vec![Violation { path: String::new(), rule: "type".into() }], diagnostics: vec![] } }
/// Validate exactly one numeric spelling without allocating a transient JSON document
fn valid_number(text: &str) -> bool {
    use json_event_parser::{JsonEvent, LowLevelJsonParser};
    let mut parser = LowLevelJsonParser::new().with_max_stack_size(usize::MAX);
    let result = parser.parse_next(text.as_bytes(), true);
    if !matches!(result.event, Some(Ok(JsonEvent::Number(value))) if value.as_ref() == text) { return false; }
    matches!(parser.parse_next(&text.as_bytes()[result.consumed_bytes..], true).event, Some(Ok(JsonEvent::Eof)))
}
`;
