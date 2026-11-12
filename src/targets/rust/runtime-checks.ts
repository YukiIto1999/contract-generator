import { support, type Support } from "./support.js";

/** Length, cardinality, pattern and binary alphabet helpers retained while generated code reaches them */
export const checkSupport: readonly Support[] = [
  support(
    "check_text",
    String.raw`/// Unicode scalar-value length validation
///
/// - value: owned or borrowed contract text
/// - minimum: optional inclusive minimum
/// - maximum: optional inclusive maximum
/// - path: member pointer
/// - state: boundary-local sink
fn check_text(value: &str, minimum: Option<usize>, maximum: Option<usize>, path: &str, state: &mut State) {
    let length = value.chars().count();
    if minimum.is_some_and(|minimum| length < minimum) { state.reject(path, "minLength"); }
    if maximum.is_some_and(|maximum| length > maximum) { state.reject(path, "maxLength"); }
}
`,
  ),
  support(
    "check_items",
    String.raw`/// Cardinality validation without cloning collection members
///
/// - length: owned collection length
/// - minimum: optional inclusive minimum
/// - maximum: optional inclusive maximum
/// - path: member pointer
/// - state: boundary-local sink
fn check_items(length: usize, minimum: Option<usize>, maximum: Option<usize>, path: &str, state: &mut State) {
    if minimum.is_some_and(|minimum| length < minimum) { state.reject(path, "minItems"); }
    if maximum.is_some_and(|maximum| length > maximum) { state.reject(path, "maxItems"); }
}
`,
  ),
  support(
    "pattern",
    String.raw`/// Reusable compiled contract patterns
///
/// - pattern: generated static regular expression
/// - Return: immutable cached expression
/// # Panics
/// A generator-translated expression that the regex crate rejects, which the generator rules out
macro_rules! pattern {
    ($pattern:expr) => {{
        static PATTERN: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
        PATTERN.get_or_init(|| match regex::Regex::new($pattern) {
            Ok(compiled) => compiled,
            Err(error) => panic!("generator-translated pattern is not a valid expression: {error}"),
        })
    }};
}
`,
    "macro",
  ),
  support(
    "base64_engine",
    String.raw`use base64::Engine as _;
/// Binding-local binary representation
///
/// - encoding: normalized encoding name
/// - Return: adopted base64 alphabet
fn base64_engine(encoding: &str) -> &'static base64::engine::general_purpose::GeneralPurpose {
    if encoding == "base64url" { &base64::engine::general_purpose::URL_SAFE_NO_PAD } else { &base64::engine::general_purpose::STANDARD }
}
`,
  ),
];
