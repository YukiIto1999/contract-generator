import { support, type Support } from "./support.js";

/** Private event-parser storage and event-writer support, never part of the public contract */
export const jsonSupport: readonly Support[] = [
  support(
    "_Json",
    String.raw`/// Flat transient JSON ownership; child identifiers never escape the codec
struct _Json {
    /// Non-recursively owned parsed nodes
    nodes: Vec<_JsonNode>,
    /// Complete document root
    root: usize,
}
impl _Json {
    /// Move a token or immediate container shell out of transient storage
    fn take(&mut self, node: usize) -> _JsonNode { std::mem::replace(&mut self.nodes[node], _JsonNode::Null) }
}
/// JSON token whose containers own only child identifiers
#[derive(Debug, PartialEq)]
enum _JsonNode {
    /// JSON null
    Null,
    /// JSON boolean
    Bool(bool),
    /// Original numeric spelling
    Number(Number),
    /// Decoded well-formed Unicode
    String(String),
    /// Ordered child identifiers
    Array(Vec<usize>),
    /// Unique decoded member names and child identifiers
    Object(std::collections::BTreeMap<String, usize>),
}
`,
    "type",
  ),
  {
    reaches: /\.is_null\(/,
    source: String.raw`impl _JsonNode {
    /// Whether this token is explicit JSON null
    fn is_null(&self) -> bool { matches!(self, Self::Null) }
}
`,
  },
  support(
    "parse_json",
    String.raw`/// Parse complete UTF-8 JSON text without publishing a partial document
fn parse_json(source: &str) -> Result<_Json, ValidationFailure> { parse_json_bytes(source.as_bytes()) }
`,
  ),
  support(
    "parse_json_bytes",
    String.raw`/// Parse library events directly into flat storage, rejecting ambiguous wire text
fn parse_json_bytes(source: &[u8]) -> Result<_Json, ValidationFailure> {
    use json_event_parser::{JsonEvent, LowLevelJsonParser};
    if source.starts_with(&[0xef, 0xbb, 0xbf]) || std::str::from_utf8(source).is_err() { return Err(json_failure()); }
    let mut parser = LowLevelJsonParser::new().with_max_stack_size(usize::MAX);
    let mut remaining = source;
    let mut nodes = Vec::new();
    let mut stack: Vec<(usize, Option<String>)> = Vec::new();
    let mut root = None;
    loop {
        let next = parser.parse_next(remaining, true);
        remaining = &remaining[next.consumed_bytes..];
        let event = match next.event { Some(Ok(event)) => event, _ => return Err(json_failure()) };
        let (node, container) = match event {
            JsonEvent::Null => (_JsonNode::Null, false),
            JsonEvent::Boolean(value) => (_JsonNode::Bool(value), false),
            JsonEvent::Number(value) => (_JsonNode::Number(Number::from_string_unchecked(value.into_owned())), false),
            JsonEvent::String(value) => (_JsonNode::String(value.into_owned()), false),
            JsonEvent::StartArray => (_JsonNode::Array(Vec::new()), true),
            JsonEvent::StartObject => (_JsonNode::Object(std::collections::BTreeMap::new()), true),
            JsonEvent::ObjectKey(key) => {
                let Some((parent, pending)) = stack.last_mut() else { return Err(json_failure()); };
                let _JsonNode::Object(members) = &nodes[*parent] else { return Err(json_failure()); };
                if members.contains_key(key.as_ref()) { return Err(json_failure()); }
                *pending = Some(key.into_owned());
                continue;
            }
            JsonEvent::EndArray | JsonEvent::EndObject => { stack.pop(); continue; }
            JsonEvent::Eof => return match root { Some(root) if stack.is_empty() => Ok(_Json { nodes, root }), _ => Err(json_failure()) },
        };
        let id = nodes.len();
        nodes.push(node);
        if let Some((parent, key)) = stack.last_mut() {
            match &mut nodes[*parent] {
                _JsonNode::Array(values) => values.push(id),
                _JsonNode::Object(members) => {
                    let Some(key) = key.take() else { return Err(json_failure()); };
                    members.insert(key, id);
                }
                _ => return Err(json_failure()),
            }
        } else {
            root = Some(id);
        }
        if container { stack.push((id, None)); }
    }
}
`,
  ),
  support(
    "json_failure",
    String.raw`/// Whole-document syntax rejection without accepted partial state
fn json_failure() -> ValidationFailure { ValidationFailure { violations: vec![Violation { path: String::new(), rule: "json".into() }], diagnostics: vec![] } }
`,
  ),
  support(
    "_JsonWriter",
    String.raw`/// Library event writer over a privately owned output buffer
struct _JsonWriter(json_event_parser::WriterJsonSerializer<Vec<u8>>);
impl _JsonWriter {
    /// Begin an unpublished JSON document
    fn new() -> Self { Self(json_event_parser::WriterJsonSerializer::new(Vec::new())) }
    /// Write a trusted event from validated canonical storage
    fn event(&mut self, event: json_event_parser::JsonEvent<'_>) {
        if let Err(error) = self.0.serialize_event(event) { panic!("invalid generated JSON event sequence: {error}"); }
    }
    /// Publish only a complete well-formed UTF-8 document
    fn finish(self) -> String {
        let bytes = match self.0.finish() { Ok(bytes) => bytes, Err(error) => panic!("incomplete generated JSON: {error}") };
        match String::from_utf8(bytes) { Ok(text) => text, Err(error) => panic!("invalid generated UTF-8: {error}") }
    }
}
`,
    "type",
  ),
  ...[
    ["begin_object", "", "StartObject", "Start an object"],
    ["end_object", "", "EndObject", "Finish an object"],
    ["begin_array", "", "StartArray", "Start an array"],
    ["end_array", "", "EndArray", "Finish an array"],
    ["null", "", "Null", "Write explicit null"],
    ["key", ", value: &str", "ObjectKey(value.into())", "Write a decoded member name"],
    [
      "string",
      ", value: &str",
      "String(value.into())",
      "Write well-formed Unicode without normalization",
    ],
    [
      "number",
      ", value: &str",
      "Number(value.into())",
      "Write a previously validated numeric spelling",
    ],
    ["boolean", ", value: bool", "Boolean(value)", "Write a boolean"],
  ].map(([name, parameter, event, description]): Support => ({
    reaches: new RegExp(`\\.${name}\\(`),
    source: `impl _JsonWriter {\n    /// ${description}\n    fn ${name}(&mut self${parameter}) { self.event(json_event_parser::JsonEvent::${event}); }\n}\n`,
  })),
  {
    reaches: /\.json\(/,
    source: String.raw`impl _JsonWriter {
    /// Copy a selected transient subtree through flat traversal and library events
    fn json(&mut self, json: &_Json, node: usize) {
        /// A borrowed visit or a pending structural event
        enum Frame<'a> {
            /// Visit one flat node
            Node(usize),
            /// Emit an object member name
            Key(&'a str),
            /// Finish an array
            EndArray,
            /// Finish an object
            EndObject,
        }
        let mut pending = vec![Frame::Node(node)];
        while let Some(frame) = pending.pop() {
            match frame {
                Frame::Key(key) => self.key(key),
                Frame::EndArray => self.end_array(),
                Frame::EndObject => self.end_object(),
                Frame::Node(node) => match &json.nodes[node] {
                    _JsonNode::Null => self.null(),
                    _JsonNode::Bool(value) => self.boolean(*value),
                    _JsonNode::Number(value) => self.number(value.as_str()),
                    _JsonNode::String(value) => self.string(value),
                    _JsonNode::Array(values) => {
                        self.begin_array();
                        pending.push(Frame::EndArray);
                        pending.extend(values.iter().rev().copied().map(Frame::Node));
                    }
                    _JsonNode::Object(values) => {
                        self.begin_object();
                        pending.push(Frame::EndObject);
                        for (key, node) in values.iter().rev() { pending.push(Frame::Node(*node)); pending.push(Frame::Key(key)); }
                    }
                },
            }
        }
    }
}
`,
  },
];
