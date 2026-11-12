//! Public codec observations of the sample contract, spelled with the literal generated names
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
        "Envelope" => observation!(types::decode_envelope, types::encode_envelope, source, binding),
        "ShortLabel" => observation!(types::decode_short_label, types::encode_short_label, source, binding),
        "ExactDecimal" => observation!(types::decode_exact_decimal, types::encode_exact_decimal, source, binding),
        "ExactTimestamp" => observation!(types::decode_exact_timestamp, types::encode_exact_timestamp, source, binding),
        _ => panic!("unknown fixture type"),
    }
}
