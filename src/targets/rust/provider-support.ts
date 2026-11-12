import { support, type Support } from "./support.js";

/** Request-side helpers retained only for operations whose HTTP binding reaches them */
export const providerSupport: readonly Support[] = [
  support(
    "invalid_parameter",
    String.raw`/// Native HTTP request syntax rejection
///
/// - Return: structured request format violation
fn invalid_parameter() -> ValidationFailure { ValidationFailure { violations: vec![Violation { path: String::new(), rule: "type".into() }], diagnostics: vec![] } }
`,
  ),
  support(
    "invalid_json",
    String.raw`/// Native HTTP body syntax rejection
///
/// - Return: structured JSON syntax violation
fn invalid_json() -> ValidationFailure { ValidationFailure { violations: vec![Violation { path: String::new(), rule: "json".into() }], diagnostics: vec![] } }
`,
  ),
  support(
    "route_matches",
    String.raw`/// Exact route template matching by segment structure
///
/// - template: generated absolute route template
/// - path: received native request path
/// - Return: whether every literal segment is equal and every placeholder segment is present
fn route_matches(template: &str, path: &str) -> bool {
    let mut expected = template.split('/');
    let mut actual = path.split('/');
    loop {
        match (expected.next(), actual.next()) {
            (None, None) => return true,
            (Some(want), Some(got)) => {
                let placeholder = want.starts_with('{') && want.ends_with('}');
                if !placeholder && want != got { return false; }
            }
            _ => return false,
        }
    }
}
`,
  ),
  support(
    "route_parameters",
    String.raw`/// Percent-decoded path parameters of a route that already matched
///
/// - template: generated absolute route template
/// - path: received native request path
/// - Return: captured scalar parameter spellings, or none when a captured segment is not UTF-8
fn route_parameters(template: &str, path: &str) -> Option<std::collections::HashMap<String, String>> {
    let mut result = std::collections::HashMap::new();
    for (want, got) in template.split('/').zip(path.split('/')) {
        if let Some(name) = want.strip_prefix('{').and_then(|value| value.strip_suffix('}')) {
            result.insert(name.into(), percent_encoding::percent_decode_str(got).decode_utf8().ok()?.into_owned());
        }
    }
    Some(result)
}
`,
  ),
  support(
    "declared_response",
    String.raw`/// Declared response construction from generation-time constants
///
/// - status: declared HTTP status code
/// - headers: lowercase header names with single-line values from the contract
/// - body: encoded result body
/// - Return: response carrying the declared status and headers
/// # Panics
/// A status or header outside the constants the generator validated
fn declared_response(status: u16, headers: &[(&'static str, &'static str)], body: axum::body::Body) -> axum::response::Response {
    let mut response = axum::response::Response::new(body);
    let Ok(status) = axum::http::StatusCode::from_u16(status) else { panic!("generated status {status} is not an HTTP status"); };
    *response.status_mut() = status;
    for &(name, value) in headers {
        response.headers_mut().insert(axum::http::HeaderName::from_static(name), axum::http::HeaderValue::from_static(value));
    }
    response
}
`,
  ),
];
