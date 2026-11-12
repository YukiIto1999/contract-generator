//! Public codec observations of the guarantees contract, spelled with the literal generated names
use serde_json::{Value, json};
use types::Binding;

/// Decode through the public codec, then encode the accepted value
macro_rules! observation {
    ($decode:path, $encode:path, $source:expr, $binding:expr) => {
        match $decode($source, $binding) {
            Ok(accepted) => json!({"accepted": true, "encoded": $encode(&accepted.value, $binding), "diagnostics": accepted.diagnostics, "violations": []}),
            Err(failure) => json!({"accepted": false, "diagnostics": failure.diagnostics, "violations": failure.violations}),
        }
    };
}

/// One public generated-codec observation
pub fn observe(name: &str, source: &str, binding: Binding) -> Value {
    match name {
        "Tree" => observation!(types::decode_tree, types::encode_tree, source, binding),
        "Expr" => observation!(types::decode_expr, types::encode_expr, source, binding),
        "Exact" => observation!(types::decode_exact, types::encode_exact, source, binding),
        "Settings" => observation!(types::decode_settings, types::encode_settings, source, binding),
        _ => panic!("unknown fixture type"),
    }
}
