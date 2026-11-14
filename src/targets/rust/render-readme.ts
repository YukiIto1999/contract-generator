import { rustRecursionLimit } from "./compiler-limits.js";
import { rustMinimumVersion } from "./dependencies.js";
import type { RustContext } from "./context.js";

/** Description of construction, codecs and the numeric and temporal representations */
const construction = `## Construction and codecs

Every canonical type has decode_<snake_name> and encode_<snake_name> functions. Decode accepts complete JSON text or UTF-8 bytes through AsRef<[u8]> and returns Result<Accepted<T>, ValidationFailure>; encoding returns complete JSON text. Transient parser storage is private, not a public DOM. Unknown object members produce pointer/name diagnostics without retained values. A rejected decode never returns a partial value. Duplicate decoded member names (including escaped-equivalent keys and unknown subtrees), a leading BOM, invalid UTF-8 and unpaired escaped surrogates are rejected. U+FEFF inside strings and keys is preserved, and well-formed Unicode is never normalized.

Constrained owned construction uses Type::try_new for private-field values or try_new_<snake_name> for ordinary scalar aliases and inherited-role narrowings. Construction and decoding call one private completion per type, so they accept exactly the same values. An inherited role remains the ancestor role type rather than a new role. Private values expose shared references and consuming extraction only. Local construction moves already accepted child graphs without a JSON round trip. The public encoder panics if a caller supplies an invalid named primitive in place of an accepted value; encode-time invariant breaches are defects rather than ordinary decode violations.

Optional nullable fields use Option<Option<T>>: outer None is omitted and Some(None) is explicit null. Optional nonnullable fields use Option<T> with null rejection in the codec. Required nullable fields use Option<T> with independent required wire-presence enforcement. Arrays and objects with composite or owned variable-size fields share private immutable payloads; unions retain exhaustive typed cases without another ownership allocation. Getters, as_slice and as_case borrow canonical children. Clone shares payloads. Unique into_parts and into_vec extraction moves owned storage, preserving the vector allocation; shared extraction copies only the immediate shell and owned scalar data, cloning child handles rather than descendant graphs. Decode, encode, defaults, structural equality, Debug and last-owner destruction traverse explicit worklists rather than the native call stack. Host input/output size limits remain host policy, not canonical nesting limits.

ExactNumber retains exact decimal/integer tokens, and a numeric scalar that declares lexical retention is stored the same way. The private json-event-parser event parser retains numeric spelling without a binary64 conversion or a fixed nesting ceiling, and the library event writer emits accepted values. Temporal storage retains arbitrary fractional precision and the original offset rather than normalizing through a native date/time type. Durations accept the date-time form and the week form. Leap seconds are accepted only when they denote the final UTC minute of June or December. Byte values own immutable bytes::Bytes and use binding-local base64 alphabets when represented in JSON.`;

/** Description of provider acceptance and the typed provider results the host maps */
const provider = `## Provider adapters

Provider Handler is a contract-side adapter interface and must not be implemented by domain/application. accept_<operation> applies defaults to every omitted optional field that declares one, at every depth: nested objects, array elements and union cases included. A default-changing operation receives an operation-specific Accepted input with stronger field presence. Defaults are built from the contract constant into Rust storage without decoding, so applying one cannot fail. <operation>_direct, <operation>_http and dispatch_ipc share this acceptance. Handler output assertions check root primitive/use-site restrictions without walking immutable accepted child graphs again.

dispatch_http and dispatch_ipc return Result<Accepted<_>, ProviderFailure>. The generated provider produces a response only for a declared result. Invalid input, a method and route or command that no operation publishes, an interrupted request body and cancellation are returned as ProviderFailure values, and the host decides the response. The Accepted diagnostics carry each unknown member name with the pointer of the object that contains it, without values. The composition root supplies routing, authentication, request cancellation and deadlines, and diagnostic handling. A bytes payload under a JSON media type is a JSON string in the binding encoding; under any other media type it is the raw body.`;

/** Description of the consumer clients, failure classes and focused checks */
const connection = `## Consumer connections

Clients expose <operation>_http and <operation>_ipc. ReqwestTransport takes the host's configured reqwest::Client and service URL. IpcTransport transfers owned UTF-8 JSON String messages using the injected host connection. IPC hosts pass the original text to dispatch_ipc and return generated envelope text without first deserializing it into a generic DOM. Tauri commands receive this raw JSON string, so framework parsing cannot impose an earlier nesting limit or normalize exact numbers. Operation-specific envelope and HTTP projection helpers live in the types crate; private parser nodes never cross dependency-unit interfaces. Futures defer effects until poll.

Failures have three classes. A declared rejection is OperationFailure::Rejected with an Accepted rejection payload. A response that could not be obtained or finished is OperationFailure::Communication, and so is a request with no wire form, such as a header value with control characters or a path value that is empty or a dot segment. A mismatch between a response and the contract is a defect and panics, except that a 502, 503 or 504 response that does not match a declared result is a communication failure. A bodyless result matches only a response with no body and no Content-Type. Bodies are consumed before success. Raw binary bodies never pass through text; empty binary, bodyless void and JSON null remain distinct.

CancellationToken and Option<tokio::time::Instant> are forwarded unchanged. ReqwestTransport forwards cancellation by dropping the request future and adds no timer; the IPC transport receives the deadline. The host owns deadline creation and enforcement, and a host transport that enforces it reports CommunicationFailure::DeadlineExceeded. The generated code adds no timeout or retry. A completed transport result wins over later token state. Cooperative handlers and IPC transports must finish their owned cleanup before returning cancellation.`;

/** Consumer documentation tied to the emitted dependency units
 * @param ctx - Complete normalized rendering context
 * @returns Generated Rust consumer documentation
 */
export function renderReadme(ctx: RustContext): string {
  return `# ${ctx.model.name} Rust contract

The types crate owns immutable validated values and codecs without an HTTP or async-runtime dependency. The transport crate supplies standard Future/Result interfaces and the adopted CancellationToken. Provider and client crates depend on types and transport independently.

Rust edition 2024 and rustc >=${rustMinimumVersion} are required by the manifests. This supported floor follows the generator's pinned native acceptance toolchain rather than the edition's historical compiler floor. The consuming workspace owns its compiler pin and may use a newer compatible compiler. Direct dependency versions are exact in each manifest. serde_json arbitrary_precision is required and must not be removed. Commit the consumer Cargo.lock for its complete transitive resolution. Each crate inherits the workspace lints (\`[lints] workspace = true\`); the generated workspace defines them, and a consuming workspace supplies its own.

## Compile-time declaration depth

All four generated crate roots set \`#![recursion_limit = "${rustRecursionLimit(ctx.model)}"]\`. This crate-local compiler allowance is derived from the finite normalized declaration graph: Rust's default reserve of 128 plus the sum of nominal storage-path contributions, including shared payload layers, presence wrappers and provider-effective root declarations. Summing each declaration's contribution bounds simple storage paths without expanding recursive nominal references. It is not a runtime JSON nesting limit and does not restrict the depth of accepted values.

Rust's [recursion_limit reference](https://doc.rust-lang.org/reference/attributes/limits.html) describes this compile-time attribute; [E0320](https://doc.rust-lang.org/error_codes/E0320.html) concerns overflow while creating drop-check rules. A finite deep chain of generated declarations needs compiler headroom even though runtime traversal is iterative. This allowance does not make infinitely expanding generic drop-check rules valid.

The attribute does not propagate to dependent crates, and Cargo dependency manifests cannot supply it for a consumer's source root. To support this contract's complete generated declaration graph, each consumer library, binary and integration-test crate root that constructs or owns these types must declare at least the following contract-derived allowance. This is a consumer build requirement, not a fixture-only setting; if the crate already declares a higher allowance, retain that single higher declaration:

\`\`\`rust
#![recursion_limit = "${rustRecursionLimit(ctx.model)}"]
\`\`\`

Place it at the crate root, before items; it may precede inner \`//!\` crate documentation. Apply it separately to each independent binary or integration-test root, not to included modules. Consumer-specific generic wrappers may require additional compile-time headroom. Keep that adjustment local to the affected crate rather than using blanket global compiler flags. Runtime value depth is a separate concern and is not a reason to raise or lower this attribute.

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
