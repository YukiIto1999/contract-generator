import { support, type Support } from "./support.js";

/** Violation accumulation and boundary extraction helpers retained while generated code reaches them */
export const stateSupport: readonly Support[] = [
  support(
    "State",
    String.raw`/// Index of a path segment, with zero denoting the document root
type _Path = usize;
/// Mutable state owned exclusively by one incomplete boundary graph
#[derive(Default)]
struct State {
    /// Known-member violations collected so far
    violations: Vec<Violation>,
    /// Unknown member observations collected so far
    diagnostics: Vec<Diagnostic>,
    /// Parent-linked path segments, materialized only for observations
    paths: Vec<(_Path, String)>,
}
impl State {
    /// Materialize one observed location as an RFC 6901 pointer
    fn pointer(&self, mut path: _Path) -> String {
        let mut segments = Vec::new();
        while path != 0 { let (parent, segment) = &self.paths[path - 1]; segments.push(segment); path = *parent; }
        let mut result = String::new();
        for segment in segments.into_iter().rev() {
            result.push('/');
            for character in segment.chars() { match character { '~' => result.push_str("~0"), '/' => result.push_str("~1"), other => result.push(other) } }
        }
        result
    }
    /// Record a semantic violation without retaining candidate data
    fn reject(&mut self, path: _Path, rule: &str) { self.violations.push(Violation { path: self.pointer(path), rule: rule.into() }); }
    /// Publish only a complete validated graph
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
  {
    reaches: /\.child\(/,
    source: String.raw`impl State {
    /// Retain only an immediate segment and its parent location
    fn child(&mut self, parent: _Path, key: impl Into<String>) -> _Path { self.paths.push((parent, key.into())); self.paths.len() }
}
`,
  },
  {
    reaches: /\.observe\(/,
    source: String.raw`impl State {
    /// Observe an unknown key without retaining its value
    fn observe(&mut self, path: _Path, key: String) { self.diagnostics.push(Diagnostic { path: self.pointer(path), key }); }
}
`,
  },
  support(
    "unknown",
    String.raw`/// Observe remaining object members without retaining their values
fn unknown(object: std::collections::BTreeMap<String, usize>, path: _Path, state: &mut State) {
    for (key, _) in object { state.observe(path, key); }
}
`,
  ),
  support(
    "object",
    String.raw`/// Extract an immediate object shell from flat parser storage
fn object(value: _JsonNode, path: _Path, state: &mut State) -> Option<std::collections::BTreeMap<String, usize>> {
    if let _JsonNode::Object(value) = value { Some(value) } else { state.reject(path, if value.is_null() { "null" } else { "type" }); None }
}
`,
  ),
  support(
    "required",
    String.raw`/// Distinguish a missing member from a present null token
fn required(value: Option<usize>, path: _Path, state: &mut State) -> Option<usize> {
    match value { Some(value) => Some(value), None => { state.reject(path, "required"); None } }
}
`,
  ),
  support(
    "text",
    String.raw`/// Move a scalar string token out of flat parsing storage
fn text(value: _JsonNode, path: _Path, state: &mut State) -> Option<String> {
    match value { _JsonNode::String(value) => Some(value), other => { state.reject(path, if other.is_null() { "null" } else { "type" }); None } }
}
`,
  ),
  support(
    "number",
    String.raw`/// Extract an exact numeric token under its declared wire encoding
fn number(value: _JsonNode, string_encoding: bool, path: _Path, state: &mut State) -> Option<Number> {
    match value {
        _JsonNode::Number(value) if !string_encoding => Some(value),
        _JsonNode::String(value) if string_encoding => {
            if valid_number(&value) { Some(Number::from_string_unchecked(value)) } else { state.reject(path, "format"); None }
        },
        other => { state.reject(path, if other.is_null() { "null" } else { "type" }); None },
    }
}
`,
  ),
  support(
    "assert_valid",
    String.raw`/// Assert the trusted construction invariant at an unwrapped scalar entrypoint
fn assert_valid(state: &State, subject: &str) {
    if !state.violations.is_empty() { panic!("{subject}: {:?}", state.violations); }
}
`,
  ),
  support(
    "filled",
    String.raw`/// Fill only omitted provider members, never explicit null or invalid input
fn filled<T>(value: Option<T>, default: impl FnOnce() -> T) -> T {
    match value { Some(value) => value, None => default() }
}
`,
  ),
];
