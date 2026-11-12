use types::{RecordId, RequestId};

fn exchange(value: RequestId) -> RecordId {
    value
}

fn main() {
    let _: fn(RequestId) -> RecordId = exchange;
}
