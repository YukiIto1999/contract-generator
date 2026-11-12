//! Public codec observations of the source-data contract, spelled with the literal generated names
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
        "Flavor" => observation!(types::decode_flavor, types::encode_flavor, source, binding),
        "Specimen" => observation!(types::decode_specimen, types::encode_specimen, source, binding),
        "Pick" => observation!(types::decode_pick, types::encode_pick, source, binding),
        _ => panic!("unknown fixture type"),
    }
}
