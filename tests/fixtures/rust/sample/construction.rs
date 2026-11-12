//! Public constrained construction and graph ownership regressions, spelled with the literal generated names
use serde_json::json;
use types::*;

/// Independently specified canonical construction input
const CANONICAL: &str = r#"{"requestId":"00000000-0000-0000-0000-000000000001","recordId":"00000000-0000-0000-0000-000000000002","correlationId":"00000000-0000-0000-0000-000000000003","label":"😀😀😀","count":3,"amount":"9007199254740993123456789.123456789012345678900","occurredAt":"0000-02-29T12:34:56.1234567890123456789+05:45","nullableText":null,"items":[{"kind":"text","text":"😀"}]}"#;

/// Canonical envelope rebuilt through public decode, member extraction and construction with chosen presence states
fn rebuild(optional_nullable: Option<Option<String>>, nullable_text: Option<String>, optional_text: Option<String>) -> Envelope {
    let (amount, correlation_id, count, items, label, _, occurred_at, _, _, record_id, request_id) = decode_envelope(CANONICAL, Binding::Ipc).expect("independent canonical input").value.into_parts();
    Envelope::try_new(amount, correlation_id, count, items, label, nullable_text, occurred_at, optional_nullable, optional_text, record_id, request_id).expect("local construction").value
}

/// Wire JSON of an envelope through the public encoder
fn encoded(value: &Envelope) -> serde_json::Value {
    serde_json::from_str(&encode_envelope(value, Binding::Ipc)).expect("encoded JSON")
}

#[test]
fn construction_counts_unicode_code_points() {
    assert!(try_new_short_label("😀😀😀".into()).is_ok());
    assert!(try_new_short_label("😀".into()).is_ok());
    let failure = try_new_short_label("😀😀😀😀".into()).expect_err("four code points exceed three");
    assert_eq!(failure.violations, vec![Violation { path: String::new(), rule: "maxLength".into() }]);
    let failure = try_new_short_label(String::new()).expect_err("zero code points are below one");
    assert_eq!(failure.violations, vec![Violation { path: String::new(), rule: "minLength".into() }]);
    assert!(std::panic::catch_unwind(|| encode_short_label(&"too long".into(), Binding::Ipc)).is_err());
}

#[test]
fn owned_children_move_without_redecode_or_clone() {
    let before = decode_envelope(CANONICAL, Binding::Ipc).expect("independent canonical input").value;
    let allocation = before.items().as_slice().as_ptr();
    let (amount, correlation_id, count, items, label, nullable_text, occurred_at, optional_nullable, optional_text, record_id, request_id) = before.into_parts();
    let after = Envelope::try_new(amount, correlation_id, count, items, label, nullable_text, occurred_at, optional_nullable, optional_text, record_id, request_id).expect("local construction").value;
    assert_eq!(allocation, after.items().as_slice().as_ptr());
}

#[test]
fn construction_distinguishes_every_presence_state_on_the_wire() {
    assert!(encoded(&rebuild(None, None, None)).get("optionalNullable").is_none());
    assert_eq!(encoded(&rebuild(Some(None), None, None)).get("optionalNullable"), Some(&serde_json::Value::Null));
    assert_eq!(encoded(&rebuild(Some(Some("kept".into())), None, None)).get("optionalNullable"), Some(&json!("kept")));
    assert_eq!(encoded(&rebuild(None, None, None)).get("nullableText"), Some(&serde_json::Value::Null));
    assert_eq!(encoded(&rebuild(None, Some("kept".into()), None)).get("nullableText"), Some(&json!("kept")));
    assert_eq!(encoded(&rebuild(None, None, Some("kept".into()))).get("optionalText"), Some(&json!("kept")));
    assert!(encoded(&rebuild(None, None, None)).get("optionalText").is_none());
}

#[test]
fn construction_rejects_a_discriminator_that_names_another_variant() {
    let failure = BinaryItemKind::try_new(json!("text")).expect_err("the tag of another variant is not this variant's tag");
    assert_eq!(failure.violations, vec![Violation { path: String::new(), rule: "literal".into() }]);
    assert!(BinaryItemKind::try_new(json!("binary")).is_ok());
    assert!(BinaryItemKind::try_new(serde_json::Value::Null).is_err());
}

#[test]
fn exact_decimal_construction_keeps_its_lexical_spelling() {
    for text in ["9007199254740993123456789.123456789012345678900", "-0.000E+02", "1e-400"] {
        let number = ExactNumber::try_new(text).expect("valid exact JSON number");
        assert_eq!(number.as_str(), text);
        let accepted = try_new_exact_decimal(number).expect("unconstrained decimal").value;
        assert_eq!(accepted.as_str(), text);
    }
    for text in ["NaN", " 1", "1 ", "0x10", "", "1.", "01"] {
        assert!(ExactNumber::try_new(text).is_err(), "{text:?} is not a JSON number");
    }
}

#[test]
fn exact_timestamp_construction_keeps_offset_year_zero_fraction_and_leap_second() {
    for text in ["0000-02-29T12:34:56.1234567890123456789+05:45", "1990-12-31T23:59:60Z", "1991-01-01T05:44:60.1234567890123456789+05:45"] {
        assert_eq!(try_new_exact_timestamp(text.to_string()).expect("valid exact timestamp").value, text);
    }
    for text in ["1990-12-31T23:58:60Z", "2024-02-29T23:59:60Z", "0001-02-29T00:00:00Z", "2024-13-01T00:00:00Z", "2024-01-01 00:00:00Z", "2024-01-01T24:00:00Z"] {
        let failure = try_new_exact_timestamp(text.to_string()).expect_err("invalid timestamp");
        assert_eq!(failure.violations, vec![Violation { path: String::new(), rule: "format".into() }], "{text}");
    }
}

#[test]
fn acceptance_applies_defaults_only_after_plain_decode() {
    let source = format!("{{\"input\":{CANONICAL}}}");
    let pre = decode_submit_input(&source, Binding::Ipc).expect("pre-default input").value;
    assert_eq!(pre.limit(), &None);
    assert_eq!(accept_submit(pre).limit(), &3);
    let source = format!("{{\"input\":{CANONICAL},\"limit\":2}}");
    let accepted = accept_submit(decode_submit_input(&source, Binding::Ipc).expect("explicit valid limit").value);
    assert_eq!(accepted.limit(), &2);
}
