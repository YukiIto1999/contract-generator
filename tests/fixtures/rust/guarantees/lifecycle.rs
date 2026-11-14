use std::pin::pin;
use std::sync::{Arc, Barrier};
use std::task::{Context, Poll, Wake, Waker};
use types::*;

const DEPTH: usize = 20_000;

fn object_json(depth: usize) -> String {
    let mut text = String::with_capacity(depth * 42 + 32);
    for _ in 0..depth { text.push_str(r#"{"label":"branch","children":[],"child":"#); }
    text.push_str(r#"{"label":"leaf","children":[]}"#);
    for _ in 0..depth { text.push('}'); }
    text
}

fn array_json(depth: usize) -> String {
    let mut text = String::with_capacity(depth * 34 + 32);
    for _ in 0..depth { text.push_str(r#"{"label":"branch","children":["#); }
    text.push_str(r#"{"label":"leaf","children":[]}"#);
    for _ in 0..depth { text.push_str("]}"); }
    text
}

fn union_json(depth: usize) -> String {
    let mut text = String::with_capacity(depth * 70 + 24);
    for _ in 0..depth { text.push_str(r#"{"kind":"add","left":"#); }
    text.push_str(r#"{"kind":"num","value":7}"#);
    for _ in 0..depth { text.push_str(r#", "right":{"kind":"num","value":1}}"#); }
    text
}

fn tree_leaf(mut tree: &Tree, arrays: bool) -> (&str, usize) {
    let mut depth = 0;
    loop {
        let next = if arrays { tree.children().as_slice().first() } else { tree.child().as_ref().and_then(Option::as_ref) };
        match next {
            Some(child) => { tree = child; depth += 1; }
            None => return (tree.label(), depth),
        }
    }
}

fn expression_leaf(mut expression: &Expr) -> (i32, usize) {
    let mut depth = 0;
    loop {
        match expression.as_case() {
            ExprCase::Num(value) => return (*value.value(), depth),
            ExprCase::Add(value) => { expression = value.left(); depth += 1; }
        }
    }
}

fn empty_children() -> TreeChildren {
    TreeChildren::try_new(Vec::new()).expect("empty children").value
}

fn num(value: i32) -> Expr {
    let kind = NumKind::try_new("num".to_owned()).expect("num tag").value;
    Expr::try_new(ExprCase::Num(Num::try_new(kind, value).expect("number").value)).expect("number case").value
}

#[test]
fn twenty_thousand_object_and_array_lifecycles() {
    for arrays in [false, true] {
        let mut constructed = Tree::try_new(None, empty_children(), "leaf".to_owned()).expect("leaf").value;
        for _ in 0..DEPTH {
            constructed = if arrays {
                Tree::try_new(None, TreeChildren::try_new(vec![constructed]).expect("children").value, "branch".to_owned())
            } else {
                Tree::try_new(Some(Some(constructed)), empty_children(), "branch".to_owned())
            }.expect("recursive construction").value;
        }
        let input = if arrays { array_json(DEPTH) } else { object_json(DEPTH) };
        let decoded = decode_tree(&input, Binding::Ipc).expect("deep decode").value;
        assert_eq!(tree_leaf(&decoded, arrays), ("leaf", DEPTH));
        assert_eq!(tree_leaf(&constructed, arrays), ("leaf", DEPTH));
        assert_eq!(constructed, decoded);
        let cloned = decoded.clone();
        assert_eq!(cloned, constructed);
        let debug = format!("{cloned:?}");
        assert!(debug.contains("leaf"));
        let encoded = encode_tree(&cloned, Binding::Http);
        let again = decode_tree(&encoded, Binding::Http).expect("deep round trip").value;
        assert_eq!(tree_leaf(&again, arrays), ("leaf", DEPTH));
        assert_eq!(again, decoded);
        let different = decode_tree(&input.replace("\"leaf\"", "\"different\""), Binding::Ipc).expect("different deep leaf").value;
        assert_ne!(different, decoded);
        drop(different);
        drop((constructed, decoded, cloned, again));
    }
}

#[test]
fn twenty_thousand_union_lifecycle() {
    let mut constructed = num(7);
    for _ in 0..DEPTH {
        let tag = AddKind::try_new("add".to_owned()).expect("add tag").value;
        let add = Add::try_new(tag, constructed, num(1)).expect("addition").value;
        constructed = Expr::try_new(ExprCase::Add(add)).expect("addition case").value;
    }
    let decoded = decode_expr(&union_json(DEPTH), Binding::Ipc).expect("deep union").value;
    assert_eq!(expression_leaf(&decoded), (7, DEPTH));
    assert_eq!(constructed, decoded);
    let cloned = decoded.clone();
    assert_eq!(cloned, constructed);
    assert!(format!("{cloned:?}").contains('7'));
    let encoded = encode_expr(&cloned, Binding::Http);
    let again = decode_expr(&encoded, Binding::Http).expect("deep union round trip").value;
    assert_eq!(expression_leaf(&again), (7, DEPTH));
    assert_eq!(again, decoded);
    let different = decode_expr(&union_json(DEPTH).replace("\"value\":7", "\"value\":8"), Binding::Ipc).expect("different union leaf").value;
    assert_ne!(different, decoded);
    drop(different);
    drop((constructed, decoded, cloned, again));
}

#[test]
fn deep_defaults_reach_the_leaf_without_replacing_explicit_values() {
    let mut source = String::from(r#"{"tree":"#);
    for _ in 0..DEPTH { source.push_str(r#"{"child":"#); }
    source.push_str(r#"{"label":"explicit"}"#);
    for _ in 0..=DEPTH { source.push('}'); }
    let decoded = decode_normalize_input(&source, Binding::Ipc).expect("deep pre-default input").value;
    assert!(decoded.tree().label().is_none());
    let accepted = accept_normalize(decoded);
    let mut node = accepted.tree();
    let mut count = 0;
    while let Some(child) = node.child() {
        assert_eq!(node.label().as_deref(), Some("branch"));
        node = child;
        count += 1;
    }
    assert_eq!(count, DEPTH);
    assert_eq!(node.label().as_deref(), Some("explicit"));
    let encoded = encode_default_tree(accepted.tree(), Binding::Ipc);
    let decoded = decode_default_tree(&encoded, Binding::Ipc).expect("defaulted tree round trip").value;
    assert_eq!(&decoded, accepted.tree());
    drop((decoded, accepted));
}

#[test]
fn completed_deep_siblings_are_cleaned_on_every_failure_path() {
    let deep = object_json(DEPTH);
    let wrong_type = format!(r#"{{"label":"root","children":[{deep},false]}}"#);
    let failed = decode_tree(&wrong_type, Binding::Ipc).expect_err("second sibling has wrong type");
    assert!(failed.violations.iter().any(|v| v.path == "/children/1"));
    let malformed = format!(r#"{{"label":"root","children":[{deep},"#);
    assert!(decode_tree(&malformed, Binding::Ipc).is_err());
    let unknown = format!(r#"{{"label":"root","children":[],"unknown":{deep}}}"#);
    let accepted = decode_tree(&unknown, Binding::Ipc).expect("unknown deep subtree ignored");
    assert_eq!(accepted.value.label(), "root");
    assert!(accepted.diagnostics.iter().any(|d| d.path.is_empty() && d.key == "unknown"));
    let invalid_unknown = format!(r#"{{"label":false,"children":[],"unknown":{deep}}}"#);
    let failed = decode_tree(&invalid_unknown, Binding::Ipc).expect_err("known invalid plus unknown subtree");
    assert!(failed.violations.iter().any(|v| v.path == "/label"));
    assert!(failed.diagnostics.iter().any(|d| d.path.is_empty() && d.key == "unknown"));
    let union = union_json(DEPTH);
    let wrong_union = format!(r#"{{"kind":"add","left":{union},"right":false}}"#);
    assert!(decode_expr(&wrong_union, Binding::Ipc).expect_err("completed union sibling").violations.iter().any(|v| v.path == "/right"));
    let duplicate_tail = format!(r#"{{"label":"root","children":[{deep}],"unknown":{{"key":1,"k\u0065y":2}}}}"#);
    assert!(decode_tree(&duplicate_tail, Binding::Ipc).is_err());
    assert_eq!(decode_tree(r#"{"label":"alive","children":[]}"#, Binding::Ipc).expect("later input remains independent").value.label(), "alive");
}

#[test]
fn parser_has_neither_128_nor_65536_container_limit() {
    for depth in [129, 65_537] {
        let input = array_json(depth);
        let accepted = decode_tree(&input, Binding::Ipc).expect("depth is not a contract limit").value;
        assert_eq!(tree_leaf(&accepted, true), ("leaf", depth));
        let ignored = format!(r#"{{"label":"root","children":[],"unknown":{input}}}"#);
        let accepted = decode_tree(&ignored, Binding::Http).expect("ignored depth is not a parser limit");
        assert!(accepted.diagnostics.iter().any(|d| d.path.is_empty() && d.key == "unknown"));
        drop(accepted);
    }
}

#[test]
fn duplicates_are_rejected_in_known_unknown_and_array_subtrees() {
    for input in [
        r#"{"label":"first","label":"second","children":[]}"#,
        r#"{"label":"first","l\u0061bel":"second","children":[]}"#,
        r#"{"label":"root","children":[{"label":"first","l\u0061bel":"second","children":[]}]}"#,
        r#"{"label":"root","children":[],"unknown":{"key":1,"k\u0065y":2}}"#,
        r#"{"label":"root","children":[],"unknown":[{"key":1,"key":2}]}"#,
    ] {
        assert!(decode_tree(input, Binding::Ipc).is_err(), "accepted duplicate: {input}");
    }
    assert!(decode_expr(r#"{"kind":"num","k\u0069nd":"num","value":7}"#, Binding::Ipc).is_err());
    let accepted = decode_tree(r#"{"label":"root","children":[],"unknown":[{"key":1},{"key":2}]}"#, Binding::Ipc).expect("same name in distinct objects is legal");
    assert_eq!(accepted.value.label(), "root");
}

#[test]
fn strict_unicode_rejects_bom_invalid_utf8_and_surrogates_but_keeps_feff() {
    let plain = r#"{"label":"leaf","children":[]}"#;
    assert!(decode_tree(&format!("\u{feff}{plain}"), Binding::Ipc).is_err());
    assert!(decode_tree(format!("\u{feff}{plain}").as_bytes(), Binding::Ipc).is_err());
    for bytes in [b"\xff".as_slice(), b"\xc0\xaf".as_slice(), b"\xed\xa0\x80".as_slice(), b"\xf4\x90\x80\x80".as_slice()] {
        let mut source = b"{\"label\":\"".to_vec();
        source.extend_from_slice(bytes);
        source.extend_from_slice(b"\",\"children\":[]}");
        assert!(decode_tree(&source, Binding::Ipc).is_err());
    }
    for input in [r#"{"label":"\ud800","children":[]}"#, r#"{"label":"\udfff","children":[]}"#, r#"{"label":"\ud800x","children":[]}"#, r#"{"label":"ok","children":[],"ignored":"\ud800"}"#] {
        assert!(decode_tree(input, Binding::Ipc).is_err());
    }
    for input in [r#"{"label":"\ufeff","children":[]}"#.to_owned(), format!("{{\"label\":\"\u{feff}\",\"children\":[]}}"), r#"{"label":"\ud83d\ude00","children":[]}"#.to_owned()] {
        let tree = decode_tree(&input, Binding::Ipc).expect("valid scalar sequence").value;
        assert!(tree.label() == "\u{feff}" || tree.label() == "😀");
        assert_eq!(decode_tree(&encode_tree(&tree, Binding::Ipc), Binding::Ipc).expect("unicode round trip").value, tree);
    }
}

#[test]
fn long_numeric_tokens_and_negative_zero_keep_exact_spelling() {
    for token in [format!("0.{}1", "0".repeat(5_000)), format!("1e-{}1", "0".repeat(5_000)), "-0".to_owned(), "-0.000E+02".to_owned()] {
        let input = format!(r#"{{"whole":-0,"ratio":{token}}}"#);
        let value = decode_exact(&input, Binding::Http).expect("long valid numeric lexeme").value;
        assert_eq!(value.whole().as_str(), "-0");
        assert_eq!(value.ratio().as_str(), token);
        let encoded = encode_exact(&value, Binding::Http);
        assert!(encoded.contains(&format!("\"ratio\":{token}")));
        assert!(encoded.contains("\"whole\":-0"));
        assert_eq!(decode_exact(&encoded, Binding::Http).expect("exact round trip").value, value);
    }
    let integer = "9".repeat(5_001);
    assert_eq!(ExactNumber::try_new(&integer).expect("unbounded lexical number").as_str(), integer);
    let ignored = format!(r#"{{"label":"root","children":[],"ignored":{integer}}}"#);
    assert_eq!(decode_tree(&ignored, Binding::Ipc).expect("unknown huge integer").value.label(), "root");
}

#[test]
fn concurrent_clone_drops_unwind_and_future_abandonment_are_stack_safe() {
    let original = decode_tree(&object_json(DEPTH), Binding::Ipc).expect("deep ownership fixture").value;
    let barrier = Arc::new(Barrier::new(5));
    let mut joins = Vec::new();
    for _ in 0..4 {
        let value = original.clone();
        let barrier = barrier.clone();
        joins.push(std::thread::spawn(move || { barrier.wait(); assert_eq!(tree_leaf(&value, false), ("leaf", DEPTH)); drop(value); }));
    }
    barrier.wait();
    drop(original);
    for join in joins { join.join().expect("concurrent release"); }
    let value = decode_tree(&object_json(DEPTH), Binding::Ipc).expect("unwind fixture").value;
    let outcome = std::panic::catch_unwind(move || { let _owned = value; panic!("intentional lifecycle unwind"); });
    assert!(outcome.is_err());
    struct Noop;
    impl Wake for Noop { fn wake(self: Arc<Self>) {} }
    {
        let value = decode_tree(&object_json(DEPTH), Binding::Ipc).expect("future fixture").value;
        let future = async move { std::future::pending::<()>().await; drop(value); };
        let mut future = pin!(future);
        let waker = Waker::from(Arc::new(Noop));
        let mut context = Context::from_waker(&waker);
        assert!(matches!(future.as_mut().poll(&mut context), Poll::Pending));
    }
    assert_eq!(decode_tree(r#"{"label":"after abandonment","children":[]}"#, Binding::Ipc).expect("future ownership released").value.label(), "after abandonment");
}
