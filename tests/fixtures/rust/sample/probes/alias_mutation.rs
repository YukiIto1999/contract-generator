use types::EnvelopeItems;

fn main() {
    let mut items = Vec::new();
    let _ = EnvelopeItems::try_new(items);
    items.clear();
}
