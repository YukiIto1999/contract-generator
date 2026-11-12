import type { RustContext } from "./context.js";

/** Description of construction, codecs and the numeric and temporal representations */
const construction = `## Construction and codecs

Every canonical type has decode_<snake_name>, decode_<snake_name>_value, encode_<snake_name>, and encode_<snake_name>_value functions. Decode returns Result<Accepted<T>, ValidationFailure>. Unknown object members produce pointer/name diagnostics without retained values. A rejected decode never returns a partial value.

Constrained owned construction uses Type::try_new for private-field values or try_new_<snake_name> for ordinary scalar aliases and inherited-role narrowings. Construction and decoding call one private completion per type, so they accept exactly the same values. An inherited role remains the ancestor role type rather than a new role. Private values expose shared references and consuming extraction only. Local construction moves already accepted child graphs without a JSON round trip. The public encoder panics if a caller supplies an invalid named primitive in place of an accepted value; encode-time invariant breaches are defects rather than ordinary decode violations.

Optional nullable fields use Option<Option<T>>: outer None is omitted and Some(None) is explicit null. Optional nonnullable fields use Option<T> with null rejection in the codec. Required nullable fields use Option<T> with independent required wire-presence enforcement. A cycle through an optional, nullable, array or union position stores the recursive value behind Box. ExactNumber retains exact decimal/integer tokens, and a numeric scalar that declares lexical retention is stored the same way. parse_json uses serde_json RawValue capture, so JSON numbers and numeric strings retain their accepted source spelling. Temporal storage retains arbitrary fractional precision and the original offset rather than normalizing through a native date/time type. Durations accept the date-time form and the week form. Leap seconds are accepted only when they denote the final UTC minute of June or December. Byte values own immutable bytes::Bytes and use binding-local base64 alphabets when represented in JSON.`;

/** Description of provider acceptance and the typed provider results the host maps */
const provider = `## Provider adapters

Provider Handler is a contract-side adapter interface and must not be implemented by domain/application. accept_<operation> applies defaults to every omitted optional field that declares one, at every depth: nested objects, array elements and union cases included. A default-changing operation receives an operation-specific Accepted input with stronger field presence. Defaults are built from the contract constant into Rust storage without decoding, so applying one cannot fail. <operation>_direct, <operation>_http and dispatch_ipc share this acceptance. Handler output assertions check root primitive/use-site restrictions without walking immutable accepted child graphs again.

dispatch_http and dispatch_ipc return Result<Accepted<_>, ProviderFailure>. The generated provider produces a response only for a declared result. Invalid input, a method and route or command that no operation publishes, an interrupted request body and cancellation are returned as ProviderFailure values, and the host decides the response. The Accepted diagnostics carry each unknown member name with the pointer of the object that contains it, without values. The composition root supplies routing, authentication, request cancellation and deadlines, and diagnostic handling. A bytes payload under a JSON media type is a JSON string in the binding encoding; under any other media type it is the raw body.`;

/** Description of the consumer clients, failure classes and focused checks */
const connection = `## Consumer connections

Clients expose <operation>_http and <operation>_ipc. ReqwestTransport takes the host's configured reqwest::Client and service URL. IpcTransport performs actual command transfer using the injected host connection. IPC hosts that receive JSON text must parse it with parse_json before returning the envelope or calling dispatch_ipc; another parser may normalize lexical numbers before the contract boundary. Futures defer effects until poll.

Failures have three classes. A declared rejection is OperationFailure::Rejected with an Accepted rejection payload. A response that could not be obtained or finished is OperationFailure::Communication, and so is a request with no wire form, such as a header value with control characters. A mismatch between a response and the contract is a defect and panics, except that a 502, 503 or 504 response that does not match a declared result is a communication failure. A bodyless result matches only a response with no body and no Content-Type. Bodies are consumed before success. Raw binary bodies never pass through text; empty binary, bodyless void and JSON null remain distinct.

CancellationToken and Option<tokio::time::Instant> are forwarded unchanged. ReqwestTransport forwards cancellation by dropping the request future and adds no timer; the IPC transport receives the deadline. The host owns deadline creation and enforcement, and a host transport that enforces it reports CommunicationFailure::DeadlineExceeded. The generated code adds no timeout or retry. A completed transport result wins over later token state. Cooperative handlers and IPC transports must finish their owned cleanup before returning cancellation.`;

/** Consumer documentation tied to the emitted dependency units
 * @param ctx - Complete normalized rendering context
 * @returns Generated Rust consumer documentation
 */
export function renderReadme(ctx: RustContext): string {
  return `# ${ctx.model.name} Rust contract

The types crate owns immutable validated values and codecs without an HTTP or async-runtime dependency. The transport crate supplies standard Future/Result interfaces and the adopted CancellationToken. Provider and client crates depend on types and transport independently.

Rust edition 2024 and rustc >=1.85.0 are required by the manifests. The consuming workspace owns its compiler pin. Direct dependency versions are exact in each manifest. serde_json arbitrary_precision is required and must not be removed. Commit the consumer Cargo.lock for its complete transitive resolution. Each crate inherits the workspace lints (\`[lints] workspace = true\`); the generated workspace defines them, and a consuming workspace supplies its own.

${construction}

${provider}

${connection}

## Focused native checks

From this generated directory with the consuming workspace's compiler and dependency cache:

\`\`\`sh
cargo build -p ${ctx.prefix}-types
cargo build -p ${ctx.prefix}-provider -p ${ctx.prefix}-client
cargo test --workspace
\`\`\`

Each command is expected to exit zero. These are consumer verification entry points rather than a claim that this generated contract was executed. The types-only dependency closure does not require reqwest, axum or Tokio.
`;
}
