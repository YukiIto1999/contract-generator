import { support, type Support } from "./support.js";

/** Violation accumulation and boundary extraction helpers retained while generated code reaches them */
export const stateSupport: readonly Support[] = [
  support(
    "State",
    String.raw`/// Mutable state owned exclusively by one incomplete boundary graph
#[derive(Default)]
struct State {
    /// Known-member violations collected so far
    violations: Vec<Violation>,
    /// Unknown member observations collected so far
    diagnostics: Vec<Diagnostic>,
}
impl State {
    /// Violation accumulation at a known member
    ///
    /// - path: rejected JSON pointer
    /// - rule: semantic rejection identifier
    fn reject(&mut self, path: &str, rule: &str) { self.violations.push(Violation { path: path.into(), rule: rule.into() }); }
    /// Publication of only a complete validated graph
    ///
    /// - value: completed graph candidate
    /// - Return: accepted graph or all collected violations
    /// # Errors
    /// Any collected violation or an absent candidate
    fn finish<T>(self, value: Option<T>) -> Result<Accepted<T>, ValidationFailure> {
        match value {
            Some(value) if self.violations.is_empty() => Ok(Accepted { value, diagnostics: self.diagnostics }),
            _ => Err(ValidationFailure { violations: self.violations, diagnostics: self.diagnostics }),
        }
    }
}
`,
    "type",
  ),
  support(
    "pointer",
    String.raw`/// RFC 6901 field pointer construction
///
/// - path: parent pointer
/// - key: member name
/// - Return: escaped member pointer
fn pointer(path: &str, key: &str) -> String { format!("{}/{}", path, key.replace('~', "~0").replace('/', "~1")) }
`,
  ),
  support(
    "unknown",
    String.raw`/// Unknown-member diagnostics without retention of values
///
/// - object: remaining members after known-member removal
/// - path: pointer of the object that contains the unknown members
/// - state: boundary-local diagnostic sink
fn unknown(object: Map<String, Value>, path: &str, state: &mut State) {
    for (key, _) in object { state.diagnostics.push(Diagnostic { path: path.into(), key }); }
}
`,
  ),
  support(
    "object",
    String.raw`/// Object extraction with typed rejection
///
/// - value: owned incoming JSON
/// - path: object pointer
/// - state: boundary-local violation sink
/// - Return: owned object members
fn object(value: Value, path: &str, state: &mut State) -> Option<Map<String, Value>> {
    if let Value::Object(value) = value { Some(value) } else { state.reject(path, if value.is_null() { "null" } else { "type" }); None }
}
`,
  ),
  support(
    "required",
    String.raw`/// Required member presence independent from JSON null
///
/// - value: removed member
/// - path: member pointer
/// - state: boundary-local violation sink
/// - Return: present JSON value
fn required(value: Option<Value>, path: &str, state: &mut State) -> Option<Value> {
    match value { Some(value) => Some(value), None => { state.reject(path, "required"); None } }
}
`,
  ),
  support(
    "nullable",
    String.raw`/// Nullable value interpretation independent from omission
///
/// - value: present JSON value
/// - path: member pointer
/// - state: boundary-local diagnostics
/// - decode: non-null value decoder
/// - Return: present null or decoded value
fn nullable<T>(value: Value, path: &str, state: &mut State, decode: impl FnOnce(Value, &str, &mut State) -> Option<T>) -> Option<Option<T>> {
    if value.is_null() { Some(None) } else { decode(value, path, state).map(Some) }
}
`,
  ),
  support(
    "text",
    String.raw`/// Scalar text extraction with null-specific rejection
///
/// - value: owned input JSON
/// - path: member pointer
/// - state: boundary-local sink
/// - Return: moved string storage
fn text(value: Value, path: &str, state: &mut State) -> Option<String> {
    match value { Value::String(value) => Some(value), other => { state.reject(path, if other.is_null() { "null" } else { "type" }); None } }
}
`,
  ),
  support(
    "number",
    String.raw`/// Numeric extraction under the selected wire encoding
///
/// - value: owned input JSON
/// - string_encoding: explicit numeric string representation
/// - path: member pointer
/// - state: boundary-local sink
/// - Return: adopted exact JSON number
fn number(value: Value, string_encoding: bool, path: &str, state: &mut State) -> Option<Number> {
    match value {
        Value::Number(value) if !string_encoding => Some(value),
        Value::String(value) if string_encoding => match serde_json::from_str::<Value>(&value) { Ok(Value::Number(_)) if value.trim() == value => Some(Number::from_string_unchecked(value)), _ => { state.reject(path, "format"); None } },
        other => { state.reject(path, if other.is_null() { "null" } else { "type" }); None },
    }
}
`,
  ),
  support(
    "assert_valid",
    String.raw`/// Defect assertion that a value claimed valid carries no violation
///
/// - state: violations collected while checking the value
/// - subject: description of the value for the defect message
/// # Panics
/// A violation was collected, which means the caller bypassed validated construction
fn assert_valid(state: &State, subject: &str) {
    if !state.violations.is_empty() { panic!("{subject}: {:?}", state.violations); }
}
`,
  ),
  support(
    "finite_number",
    String.raw`/// JSON number of a finite binary float
///
/// - value: finite float validated before encoding
/// - Return: JSON number
/// # Panics
/// A non-finite float, which construction and decoding reject before any encoding
fn finite_number(value: f64) -> Value {
    match Number::from_f64(value) { Some(number) => Value::Number(number), None => panic!("a non-finite float has no JSON number") }
}
`,
  ),
  support(
    "filled",
    String.raw`/// Provider default substitution for an omitted member
///
/// - value: member as supplied
/// - default: construction of the contract default, run only for an omitted member
/// - Return: the supplied member or the default
fn filled<T>(value: Option<T>, default: impl FnOnce() -> T) -> T {
    match value { Some(value) => value, None => default() }
}
`,
  ),
];
