import { support, type Support } from "./support.js";

/** Exact numeric comparison and domain helpers retained while generated code reaches them */
export const numericSupport: readonly Support[] = [
  support("BigInt", "use num_bigint::BigInt;\n", "type"),
  support(
    "numeric_parts",
    String.raw`/// Exact decimal ordering without binary floating conversion
///
/// - text: JSON number token
/// - Return: sign with normalized digits and decimal position, or None for an exponent outside the JSON grammar
fn numeric_parts(text: &str) -> Option<(bool, String, BigInt)> {
    let negative = text.starts_with('-');
    let unsigned = text.trim_start_matches('-');
    let (mantissa, exponent) = unsigned.split_once(['e', 'E']).map_or((unsigned, "0"), |parts| parts);
    let exponent = exponent.parse::<BigInt>().ok()?;
    let fraction = mantissa.split_once('.').map_or(0, |(_, part)| part.len());
    let digits = mantissa.replace('.', "");
    let digits = digits.trim_start_matches('0');
    if digits.is_empty() { return Some((false, "0".into(), BigInt::from(0))); }
    Some((negative, digits.trim_end_matches('0').into(), exponent - BigInt::from(fraction) + BigInt::from(digits.len())))
}
`,
  ),
  support(
    "integer_token",
    String.raw`/// Native integer conversion after exact integrality checking
///
/// - number: exact JSON numeric token
/// - Return: bounded canonical integer spelling
fn integer_token(number: &Number) -> Option<String> {
    let (negative, digits, position) = numeric_parts(number.as_str())?;
    if digits == "0" { return Some("0".into()); }
    if position < BigInt::from(digits.len()) || position > BigInt::from(20) { return None; }
    let length = position.to_string().parse::<usize>().ok()?;
    let mut result = String::with_capacity(length + usize::from(negative));
    if negative { result.push('-'); }
    result.push_str(&digits);
    result.extend(std::iter::repeat_n('0', length - digits.len()));
    Some(result)
}
`,
  ),
  support(
    "numeric_compare",
    String.raw`use std::cmp::Ordering;
/// Exact comparison of two valid JSON number tokens
///
/// - left: first exact token
/// - right: second exact token
/// - Return: numeric ordering independent of lexical scale, or None for a malformed token
fn numeric_compare(left: &str, right: &str) -> Option<Ordering> {
    let (ln, ld, lp) = numeric_parts(left)?;
    let (rn, rd, rp) = numeric_parts(right)?;
    if ld == "0" && rd == "0" { return Some(Ordering::Equal); }
    if ln != rn { return Some(if ln { Ordering::Less } else { Ordering::Greater }); }
    let order = if ld == "0" { Ordering::Less } else if rd == "0" { Ordering::Greater } else {
        lp.cmp(&rp).then_with(|| ld.bytes().chain(std::iter::repeat(b'0')).take(ld.len().max(rd.len())).cmp(rd.bytes().chain(std::iter::repeat(b'0')).take(ld.len().max(rd.len()))))
    };
    Some(if ln { order.reverse() } else { order })
}
`,
  ),
  support(
    "check_number",
    String.raw`/// Numeric interval validation in exact arithmetic
///
/// - text: exact number token
/// - minimum: optional lower boundary
/// - min_exclusive: strict lower boundary
/// - maximum: optional upper boundary
/// - max_exclusive: strict upper boundary
/// - path: rejected location
/// - state: boundary-local sink
fn check_number(text: &str, minimum: Option<&str>, min_exclusive: bool, maximum: Option<&str>, max_exclusive: bool, path: _Path, state: &mut State) {
    if minimum.is_some_and(|bound| numeric_compare(text, bound).is_none_or(|order| order.is_lt() || min_exclusive && order.is_eq())) { state.reject(path, "minimum"); }
    if maximum.is_some_and(|bound| numeric_compare(text, bound).is_none_or(|order| order.is_gt() || max_exclusive && order.is_eq())) { state.reject(path, "maximum"); }
}
`,
  ),
  support(
    "integral",
    String.raw`/// Integrality of an exact number token
///
/// - text: exact number token
/// - Return: whether the token denotes an integer, whatever its spelling
fn integral(text: &str) -> bool {
    numeric_parts(text).is_some_and(|(_, digits, position)| digits == "0" || position >= BigInt::from(digits.len()))
}
`,
  ),
  support(
    "check_integer",
    String.raw`/// Integer domain validation of an exact number token
///
/// - text: exact number token
/// - path: rejected location
/// - state: boundary-local sink
fn check_integer(text: &str, path: _Path, state: &mut State) {
    if !integral(text) { state.reject(path, "type"); }
}
`,
  ),
  support(
    "check_float",
    String.raw`/// Finite binary float domain validation of an exact number token
///
/// - text: exact number token
/// - single: validate against binary32 rather than binary64
/// - path: rejected location
/// - state: boundary-local sink
fn check_float(text: &str, single: bool, path: _Path, state: &mut State) {
    let finite = if single { text.parse::<f32>().is_ok_and(f32::is_finite) } else { text.parse::<f64>().is_ok_and(f64::is_finite) };
    if !finite { state.reject(path, "type"); }
}
`,
  ),
  support(
    "literal_equal",
    String.raw`/// Exact primitive literal comparison
///
/// - value: candidate JSON
/// - expected: generated exact JSON
/// - Return: value-level literal equality
fn literal_equal(value: &_JsonNode, expected: &_JsonNode) -> bool {
    match (value, expected) { (_JsonNode::Number(left), _JsonNode::Number(right)) => numeric_compare(left.as_str(), right.as_str()).is_some_and(Ordering::is_eq), _ => value == expected }
}
`,
  ),
];
