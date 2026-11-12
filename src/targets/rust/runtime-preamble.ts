/** Public codec vocabulary that every generated types crate exposes */
export const typesPreamble = String.raw`//! Validated contract values with owned immutable graphs
use serde_json::{Map, Number, Value};

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
        match serde_json::from_str::<Value>(text) {
            Ok(Value::Number(_)) if text.trim() == text => Ok(Self(Number::from_string_unchecked(text.into()))),
            _ => Err(ValidationFailure { violations: vec![Violation { path: String::new(), rule: "type".into() }], diagnostics: vec![] }),
        }
    }
    /// Borrowed exact lexical representation
    ///
    /// - self: validated number
    /// - Return: original JSON numeric spelling
    pub fn as_str(&self) -> &str { self.0.as_str() }
}
/// Nesting bound matching serde_json's default recursion protection
const JSON_DEPTH_LIMIT: usize = 128;
/// Serde raw-value graph conversion preserving every JSON number spelling
///
/// - raw: syntax-validated JSON value slice captured by serde_json
/// - depth: remaining container nesting allowance
/// - Return: owned JSON graph whose numbers retain their source token or None beyond the nesting bound
/// # Errors
/// Invalid JSON syntax below the captured value
fn lexical(raw: &serde_json::value::RawValue, depth: usize) -> Result<Option<Value>, serde_json::Error> {
    let text = raw.get();
    match text.as_bytes().first() {
        Some(b'{' | b'[') if depth == 0 => Ok(None),
        Some(b'{') => {
            let members: std::collections::BTreeMap<String, &serde_json::value::RawValue> = serde_json::from_str(text)?;
            let mut object = Map::new();
            for (key, member) in members { let Some(value) = lexical(member, depth - 1)? else { return Ok(None); }; object.insert(key, value); }
            Ok(Some(Value::Object(object)))
        }
        Some(b'[') => {
            let members: Vec<&serde_json::value::RawValue> = serde_json::from_str(text)?;
            let mut values = Vec::with_capacity(members.len());
            for member in members { let Some(value) = lexical(member, depth - 1)? else { return Ok(None); }; values.push(value); }
            Ok(Some(Value::Array(values)))
        }
        Some(b'-' | b'0'..=b'9') => Ok(Some(Value::Number(Number::from_string_unchecked(text.into())))),
        _ => serde_json::from_str(text).map(Some),
    }
}
/// JSON parsing through the adopted Serde raw-value capture
///
/// - source: raw JSON text
/// - Return: parsed value with exact numeric spelling or structured syntax violation
/// # Errors
/// Invalid JSON syntax
pub fn parse_json(source: &str) -> Result<Value, ValidationFailure> {
    let syntax = || ValidationFailure { violations: vec![Violation { path: String::new(), rule: "json".into() }], diagnostics: vec![] };
    let raw: &serde_json::value::RawValue = serde_json::from_str(source).map_err(|_| syntax())?;
    lexical(raw, JSON_DEPTH_LIMIT).ok().flatten().ok_or_else(syntax)
}
`;
