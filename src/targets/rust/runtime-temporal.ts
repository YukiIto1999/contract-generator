import { support, type Support } from "./support.js";

/** Calendar and clock validation retained while generated code reaches it */
export const temporalSupport: readonly Support[] = [
  support(
    "valid_date",
    String.raw`/// Calendar validity for lexical dates including year zero
///
/// - text: four-digit Gregorian date
/// - Return: date validity
fn valid_date(text: &str) -> bool {
    if text.len() != 10 || !text.is_ascii() { return false; }
    let Ok(year) = text[0..4].parse::<u32>() else { return false; };
    let Ok(month) = text[5..7].parse::<usize>() else { return false; };
    let Ok(day) = text[8..10].parse::<u32>() else { return false; };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    text.as_bytes()[4] == b'-' && text.as_bytes()[7] == b'-' && (1..=12).contains(&month) && day >= 1 && day <= days[month - 1]
}
`,
  ),
  support(
    "civil_days",
    String.raw`/// Proleptic Gregorian day index including year zero
///
/// - year: full Gregorian year
/// - month: one-based month
/// - day: one-based day
/// - Return: Unix-relative day index
fn civil_days(year: i64, month: i64, day: i64) -> i64 {
    let year = year - i64::from(month <= 2);
    let era = year.div_euclid(400);
    let within = year - era * 400;
    let ordinal = (153 * (month + if month > 2 { -3 } else { 9 }) + 2) / 5 + day - 1;
    era * 146_097 + within * 365 + within / 4 - within / 100 + ordinal - 719_468
}
`,
  ),
  support(
    "valid_leap_second",
    String.raw`/// Leap-second placement at a UTC month-end final minute
///
/// - text: lexically valid offset date-time
/// - Return: ordinary second or valid leap-second placement
fn valid_leap_second(text: &str) -> bool {
    let field = |range: std::ops::Range<usize>| text[range].parse::<i64>().unwrap_or(-1);
    if field(17..19) != 60 { return true; }
    let suffix = &text[text.len() - 6..];
    let offset = if text.ends_with(['Z', 'z']) { 0 } else { (field(text.len() - 5..text.len() - 3) * 60 + field(text.len() - 2..text.len())) * if suffix.starts_with('-') { -1 } else { 1 } };
    let local = field(11..13) * 60 + field(14..16) - offset;
    if local.rem_euclid(1440) != 1439 { return false; }
    let (year, month, day) = (field(0..4), field(5..7), field(8..10));
    let utc_day = civil_days(year, month, day) + local.div_euclid(1440);
    utc_day == civil_days(year, 6, 30) || utc_day == civil_days(year, 12, 31) || utc_day == civil_days(year - 1, 12, 31)
}
`,
  ),
  support(
    "valid_duration",
    String.raw`/// RFC 3339 duration in the date-time form or the week form
///
/// - text: source spelling
/// - Return: whether the text is a nonempty date-time duration or a week count
fn valid_duration(text: &str) -> bool {
    let week = pattern!(r"^P[0-9]+W$").is_match(text);
    let designators = pattern!(r"^-?P(?:[0-9]+Y)?(?:[0-9]+M)?(?:[0-9]+D)?(?:T(?:[0-9]+H)?(?:[0-9]+M)?(?:[0-9]+(?:\.[0-9]+)?S)?)?$").is_match(text);
    week || (designators && !text.ends_with(['P', 'T']))
}
`,
  ),
  support(
    "temporal",
    String.raw`/// Exact date and time lexical validation without normalization
///
/// - text: source spelling
/// - kind: normalized temporal scalar
/// - Return: full-profile lexical validity
fn temporal(text: &str, kind: &str) -> bool {
    match kind {
        "plainDate" => valid_date(text),
        "plainTime" => pattern!(r"^(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?$").is_match(text),
        "offsetDateTime" | "utcDateTime" => {
            pattern!(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt](?:[01][0-9]|2[0-3]):[0-5][0-9]:(?:[0-5][0-9]|60)(?:\.[0-9]+)?(?:[Zz]|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$").is_match(text)
                && valid_date(&text[..10]) && valid_leap_second(text) && (kind != "utcDateTime" || text.ends_with(['Z', 'z']) || text.ends_with("+00:00") || text.ends_with("-00:00"))
        },
        "duration" => valid_duration(text),
        _ => false,
    }
}
`,
  ),
];
