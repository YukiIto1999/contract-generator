use types::{Envelope, RequestId};

fn alias_reference(value: &Envelope) -> &RequestId {
    value.correlation_id()
}

fn main() {
    let _: fn(&Envelope) -> &RequestId = alias_reference;
}
