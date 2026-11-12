//! Public codec observations of the wide contract, spelled with the literal generated names
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
        "Row" => observation!(types::decode_row, types::encode_row, source, binding),
        "Page" => observation!(types::decode_page, types::encode_page, source, binding),
        _ => panic!("unknown fixture type"),
    }
}
