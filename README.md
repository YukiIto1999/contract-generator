[English](README.md) | [日本語](README.ja.md)

# Contract Generator

Contract Generator is a TypeSpec emitter that turns one public contract into C#, Rust, and TypeScript code that keeps the contract's meaning.
For each language it generates the public types, validated construction, codecs, the provider-side acceptance and dispatch, and the consumer-side communication for HTTP and for an IPC transport supplied by the host.
This README is for developers who author a contract and use the generated code in their projects.

## What it guarantees

| Area          | Guarantee                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Roles         | Scalars marked `@distinct` become types that cannot be assigned to each other, and an alias stays the same type                                 |
| Values        | Lengths count Unicode code points, integers beyond ±(2^53−1) and long decimals keep their value, and date-times keep their precision and offset |
| Presence      | A missing field, an explicit `null`, and a TypeScript `undefined` are three different inputs                                                    |
| Construction  | Local construction and wire decoding share one completion step and return either an accepted value or violations with a position and a rule     |
| Unknown input | An unknown object field is accepted and reported by position and name, its value is dropped, and an unknown variant is rejected                 |
| Defaults      | Only the provider applies a default, to an omitted field, for HTTP, IPC, and direct calls alike                                                 |
| Results       | A response is selected by status, media type, and declared headers before its body is decoded                                                   |
| Failures      | A declared rejection, a contract mismatch, a communication failure, and a cancellation stay separate                                            |
| Output        | Either every selected language is generated or the previous output stays untouched, and the same input gives the same bytes                     |

[spec.md](./spec.md) states these as acceptance conditions.

## Installation

Check out the repository into the same workspace, install its dependencies, and build it.
The package is not published to a registry.

```sh
npm ci
npm run build
```

It requires Node 24.11 or later within 24.x, or Node 26 or later, and `@typespec/compiler` 1.17.0.

## Authoring a contract

Import the profile and declare the contract in one namespace.

```typespec
import "../contract-generator/lib/main.tsp";
using ContractGenerator;

namespace Sample;

@distinct
@format("uuid")
scalar RequestId extends string;

@minLength(1)
@maxLength(3)
scalar ShortLabel extends string;

model Receipt {
  value: string;
}

@error
model Rejected {
  code: "invalid";
  message: string;
}

@outcomes
union SubmitOutcome {
  created: Receipt,
  completed: void,
  rejected: Rejected,
}

op submit(id: RequestId, label: ShortLabel, @providerDefault(3) limit?: int32): SubmitOutcome;

@@publish(submit, #["http", "ipc"]);
@@httpBinding(submit, "POST", "/submit");
@@httpResult(submit, "created", 201, "application/json");
@@httpResult(submit, "completed", 204);
@@httpResult(submit, "rejected", 400, "application/json");
@@ipcBinding(submit, "submit");
@@ipcResult(submit, "created", "created");
@@ipcResult(submit, "completed", "completed");
@@ipcResult(submit, "rejected", "rejected");
```

An operation returns a named union marked `@outcomes`, and a payload model marked `@error` makes its outcome a declared rejection.
A successful outcome maps to a 2xx status and a declared rejection to a 4xx or 5xx status.

| Decorator                                                 | Meaning                                                                                              |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `@distinct`                                               | The scalar is a separate nominal role                                                                |
| `@preserveLexical`                                        | The scalar keeps its source spelling in addition to its value                                        |
| `@outcomes`                                               | The union lists the results of an operation                                                          |
| `@providerDefault(value)`                                 | The provider uses the value when the optional field is omitted                                       |
| `@@publish(op, #["http", "ipc"])`                         | The operation must be generated for every listed binding                                             |
| `@@httpBinding(op, method, path, body?)`                  | The route, with `body` as a parameter name, `"*"` for the remaining parameters, or `"-"` for no body |
| `@@httpParameter(op, parameter, location, wireName)`      | A scalar parameter placed in `path`, `query`, or `header`                                            |
| `@@httpResult(op, outcome, status, mediaType?, headers?)` | The status, media type, and exact header values that identify one outcome                            |
| `@@ipcBinding(op, command)`                               | The command name passed to the host transport                                                        |
| `@@ipcResult(op, outcome, tag)`                           | The response tag that identifies one outcome                                                         |
| `@@bindingEncoding(target, binding, encoding)`            | The wire encoding for one binding only                                                               |

The built-in constraints, `@doc`, `@encode`, `@discriminator` on models, and `@discriminated` on unions keep their TypeSpec meaning.
Write a default with `@providerDefault`, because a built-in `= value` default is rejected.
Write a header selector key that is not a plain identifier in backticks, as in ``#{`x-kind`: "a"}``.

A route is an absolute path of nonempty segments that are neither `.` nor `..`.
A percent-encoded spelling of either dot segment is rejected too.
An empty segment is allowed only as a trailing slash, and a placeholder fills a whole segment.
A generated client never sends a request outside the configured origin.
Redirects are never followed, including redirects to the same origin; a 3xx response is undeclared and becomes a contract defect. The bundled transports enforce this policy, and custom transports must preserve it.
A path value that is empty, `.`, or `..`, or a header value with a control character other than a horizontal tab, has no wire form, so the call returns a communication failure before anything is sent.
Header validation examines the original text before the platform can trim it.

## Generating

Name the emitter by its checkout path and key its options by the package name.

```yaml
emit:
  - "../contract-generator"
options:
  "@yukiito1999/contract-generator":
    emitter-output-dir: "{project-root}/generated"
    namespace: Sample
    targets: [typescript, csharp, rust]
    typescript-effect-module: "./effect.js"
```

```sh
tsp compile main.tsp
```

| Option                     | Required                   | Meaning                                                                    |
| -------------------------- | -------------------------- | -------------------------------------------------------------------------- |
| `namespace`                | Yes                        | The public namespace to generate                                           |
| `targets`                  | Yes                        | The languages that must all succeed                                        |
| `typescript-effect-module` | With TypeScript operations | The module that exports `Effect` and `deferEffect`                         |
| `csharp-namespace`         | No                         | The C# namespace, which defaults to the contract namespace                 |
| `rust-crate-prefix`        | No                         | The prefix of the Rust crate names                                         |
| `check`                    | No                         | Compare with the published output and fail on a difference without writing |

The emitter owns its output directory.
It refuses a directory that it did not generate and a generated file that was edited by hand.
Publication excludes other cooperating generators with a sibling `.<output>.contract-generator.lock` ownership marker.
A competing generation or drift check fails with `output-conflict`; it does not wait or take over ownership.
Replacement moves the old tree aside before installing the new one, so readers outside this protocol can observe a missing directory between the two moves.
This is not an atomic swap or a power-loss durability guarantee.
Normal completion releases ownership, but a killed process can leave the marker and its previous output behind.
The emitter reports this conflict without deleting the marker; recovery requires confirming that no owner remains and preserving any reported backup before removing the abandoned marker.
With exclusive ownership and a missing output, a normal generation restores a single verified, unmodified previous tree before continuing.
Run it with `check: true` in the verification entry of the consuming repository to detect drift without creating ownership or recovering interrupted output.

## Output

| Path                                                               | Content                                                                                                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript/contract.ts`                                           | Types, construction, and codecs using `ts-results-es`, `lossless-json`, `@streamparser/json` 0.0.26, `@scure/base`, and, only when patterns are present, `re2js` |
| `typescript/provider.ts`, `typescript/client.ts`                   | Handler interfaces with dispatch, and HTTP and IPC clients                                                                                                       |
| `csharp/types/`, `csharp/provider/`, `csharp/client/`              | Three projects, of which the types project references TypeModeling only                                                                                          |
| `rust/types/`, `rust/transport/`, `rust/provider/`, `rust/client/` | Four crates, of which the types crate has no HTTP or async-runtime dependency                                                                                    |
| `schemas/`, `http/openapi.json`, `docs/reference.md`               | Reference projections that are not complete validation schemas and are not inputs to generation                                                                  |

The generated handler interface is the contract side of the connection.
A hand-written adapter implements it and calls the application, so the application does not depend on generated code.
A generated provider returns invalid input, an unknown operation, and a cancellation to the host as typed results, and the host decides the response.
An unknown-member diagnostic names the containing object by its JSON pointer in `path` and the member in `key`.

TypeScript `create`, `decode`, `fromWire`, and provider acceptance return `BoundaryRejection` on failure: read `error.violations` for known-member failures and `error.diagnostics` for unknown-member observations.
Unknown values never enter either collection, including when a known member fails.
`encode` and `toWire` retain their violation-array error type.

TypeScript codecs use synchronous stack-safe traversal without a canonical depth limit.
They reuse completed immutable children, reject declared ancestor cycles rather than shared DAG children, and never read unknown local member values.
`encode` writes JSON directly; `toWire` produces an independently owned binding graph.
Hosts remain responsible for byte and output limits before admission or sending.

The JSON wire profile rejects duplicate object member names everywhere, including equal values, escaped-equivalent names, and unknown subtrees.
Both text and UTF-8 byte entrypoints reject a leading BOM and ill-formed Unicode rather than replacing it.
U+FEFF inside strings and keys, other well-formed characters, and exact numeric spellings are preserved without normalization or a binary64 restriction.
An input that is ambiguous under these rules is rejected, never repaired or normalized.

## Language integration

### TypeScript

The generated code returns `Result` and `AsyncResult` from `ts-results-es` and does not define an effect type.
The module named by `typescript-effect-module` exports `Effect<Env, E, A>`, callable as `(env, signal, deadlineAt) => AsyncResult<A, E>`, and `deferEffect`, which takes a function of that shape.
`createFetchTransport` forwards the signal, forces manual redirect handling, and adds no timer. Browser `opaqueredirect` responses are contract defects, not successful responses or communication failures.

Install the generated module's runtime dependencies directly in the consuming application:

```sh
npm install --save-exact ts-results-es@7.1.0 lossless-json@4.3.3 @streamparser/json@0.0.26 @scure/base@2.4.0
```

Pattern-bearing generated modules require the consuming application's own direct runtime dependency `"re2js": "2.10.0"` in `package.json`.
Do not rely on the generator's transitive installation: generation emits TypeScript source, not a consumer package manifest.
Pattern-free modules import no RE2JS.
The generator also uses RE2JS for pattern preflight and constant validation; `@eslint-community/regexpp` 4.12.3 is a generator-only parser dependency and is not imported by generated code.

### C#

The generated projects require [TypeModeling `v0.4.0`](https://github.com/YukiIto1999/typemodeling-dotnet/tree/v0.4.0) and [EffectSystem `v0.4.0`](https://github.com/YukiIto1999/effectsystem-dotnet/tree/v0.4.0).
Place the source checkouts side by side as `typemodeling-dotnet/` and `effectsystem-dotnet/`.
Write the absolute project paths once, as the MSBuild properties `TypeModelingProjectPath` and `EffectSystemProjectPath`, in the consuming repository's `Directory.Build.props`.
MSBuild imports the first `Directory.Build.props` that it finds when it walks up from each project's directory, so every project in that tree receives the same settings.
A property set only in the consuming `.csproj` is not forwarded to referenced projects.
The generated projects are ordinary projects of the consumer: they declare no analyzer reference and import no props of their own.
Every C# project below that `Directory.Build.props`, generated or hand-written, receives its analyzers from the props that the file imports, so write the import once in the `Directory.Build.props` at the root of the consuming repository and in no project.
`csharp/Contract.Analysis.props` imports `TypeModeling.Analysis.props` from the TypeModeling checkout that `TypeModelingProjectPath` names, which attaches `TypeModeling.Analyzers` to every C# project without adding analyzer assemblies as runtime dependencies.
It adds only what belongs to the generated contract: `CS8509`, `CS8524`, `CS8655`, `CS8846`, `CS8847` and `TYPMOD021` are errors, and a generated global analyzer configuration enables `TYPMOD021`.
Replace `/absolute/path` with the directory containing the two source checkouts, and `generated` with the generated output directory:

```xml
<Project>
  <PropertyGroup>
    <TypeModelingProjectPath>/absolute/path/typemodeling-dotnet/src/TypeModeling/TypeModeling.csproj</TypeModelingProjectPath>
    <EffectSystemProjectPath>/absolute/path/effectsystem-dotnet/src/EffectSystem/EffectSystem.csproj</EffectSystemProjectPath>
    <GeneratedContractRoot>$(MSBuildThisFileDirectory)generated</GeneratedContractRoot>
  </PropertyGroup>
  <Import Project="$(GeneratedContractRoot)/csharp/Contract.Analysis.props" />
  <Import Project="$(GeneratedContractRoot)/csharp/Contract.EffectAnalysis.props" />
</Project>
```

A consuming `.csproj` has no import and only references the generated project:

```xml
<ItemGroup>
  <ProjectReference Include="$(GeneratedContractRoot)/csharp/types/Contract.Types.csproj" />
</ItemGroup>
```

`dotnet build` needs no properties.
Because `Directory.Build.props` imports files from the generated output, generate before you build.
When the generated output sits below the directory of `Directory.Build.props`, the generated projects receive the same settings.
A generated project imports nothing itself, so output outside that tree builds only when its dependency paths come from environment variables or `dotnet build -p:` properties, and nothing analyzes it: it receives neither the analyzers nor the error policy.
Without the TypeModeling analyzer the compiler reports `CS8509` for the generated switches over closed types, so that build prints those warnings and fails under `TreatWarningsAsErrors`.
To analyze it, put a `Directory.Build.props` above the generated directory that imports the same two files as the example above, because the generated projects do not receive the consumer's `Directory.Build.props` there.
When `Directory.Build.props` exists at several levels, MSBuild uses only the nearest one; to keep the settings above it, begin the nearer file with `<Import Project="$([MSBuild]::GetPathOfFileAbove('Directory.Build.props', '$(MSBuildThisFileDirectory)../'))" />`.

A consumer of only the types unit can omit `EffectSystemProjectPath` and the `Contract.EffectAnalysis.props` import.
`csharp/Contract.EffectAnalysis.props` imports `EffectSystem.Analysis.props` from the EffectSystem checkout that `EffectSystemProjectPath` names, which attaches `EffectSystem.Analyzers`, and it makes `EFFSYS001` to `EFFSYS015` errors.
A consumer that uses `Effect` keeps that import after `Contract.Analysis.props`, as in the example.
Both generated files import an owner's props only when nothing imported it before, so a `Directory.Build.props` that already imports `TypeModeling.Analysis.props` or `EffectSystem.Analysis.props` keeps a single attachment of each analyzer.
A missing or stopped analyzer fails the build with the owners' diagnostics (`TYPMOD201` to `TYPMOD203`, `TYPMOD022`, `EFFSYS201`, `EFFSYS202`, `EFFSYS016`), and a checkout without the props at its root fails it with an error that names the project-path property.
To fail a solution build for a project that these imports did not reach, add the `Directory.Solution.targets` that the owners' READMEs describe.
Generated switches over closed types enumerate every variant without a default or discard arm.
The generated global analyzer configuration enables `TYPMOD021`, which rejects explicit catchall arms over closed types. Consumers import this configuration through `Contract.Analysis.props`, so adding a future variant requires an explicit consumer case.
Effect-building methods take no deadline argument. The composition root supplies a clock, deadline diagnostics, an absolute `Deadline`, and the deadline-failure factory to `EffectRuntime`; native effects receive that same deadline through `Try`. IPC transports accept `Deadline` with the cancellation token last, and HTTP transports read `HttpRequestOptionsKey<Deadline>` through `ContractClient.DeadlineOption`.
`IClientRequirements.Http` supplies an `IHttpTransport`, while `ServiceOrigin` supplies the destination. Use the generated `SocketsHttpTransport` for native HTTP: it owns its handler and connection pool, disables redirects after host configuration, and adds neither an `HttpClient` timeout nor response buffering. The host disposes the transport; each response belongs to its caller. A configuration callback must not retain or later mutate the handler. Custom transports implement the same no-redirect contract.
Arrays have nominal immutable wrappers named `<ArrayName>Codec.Value`, backed by `ImmutableArray<T>`; nesting them in their codecs avoids introducing additional top-level contract-name exclusions. Their default struct value is invalid, and their factories copy and validate caller-owned collections. Private work stacks handle object, array, union, and provider-default traversal without a contract depth quota. Defaults preserve shared-child identity, do not merge distinct equal-valued children, and reuse unchanged children. JSON acceptance rejects duplicate names, a leading BOM, and ill-formed Unicode even inside unknown values, while preserving valid character and numeric spellings. Byte and output-size limits remain the host's responsibility.
Object and provider-accepted models are sealed get-only classes with reference equality, not records with recursive equality or `with` cloning. Array values compare their immutable backing-storage identity. Union and outcome records retain exhaustive cases, but their composite payload observations do not recursively traverse object graphs. These observations are not wire-equivalence checks; use generated construction and codecs rather than depending on deep record equality.

### Rust

The generated crates use the standard `Result` and futures, with `CancellationToken` from `tokio-util` for cancellation.
The host owns the server: it passes each request to `dispatch_http` or `dispatch_ipc` and maps the returned `ProviderFailure` to its own response.
For native HTTP, construct `ReqwestTransport` with `ReqwestTransport::new(reqwest::Client::builder(), origin)?`. It applies the no-redirect policy to the host-configured builder before building the client, so it accepts no already built `reqwest::Client`.
IPC hosts pass the original UTF-8 JSON `String` directly to `dispatch_ipc` and return its generated envelope text; `IpcTransport` uses the same text boundary. Tauri commands receive that string instead of a generic JSON DOM, so framework parsing cannot impose an earlier nesting limit or normalize exact numbers.
Construction, decoding, encoding, defaults, equality, debugging, cloning, and destruction of recursive values do not recurse with value depth. Immutable composite payloads are shared; borrowed access and cloning do not copy descendant graphs. Native string and UTF-8 byte decoding enforce the strict JSON profile above, including duplicate names in unknown subtrees.
The generated Rust README supplies a declaration-graph-derived `recursion_limit` for each consumer crate root. This compiler allowance is separate from runtime JSON depth, is not inherited through dependencies, and must also be applied to independent binary and integration-test roots that own the generated types.
The manifests carry the lints of the architecture standard and require Rust 1.94.0 or a newer compatible compiler.
The supported floor follows the pinned native acceptance toolchain, not the edition floor, which does not establish compiler support.
The minimum-version proof is the existing native Rust collection run once with `RUST_CONTRACT_EXACT_MINIMUM=1`, which fails unless rustc and Cargo are exactly 1.94.0.
That collection builds every generated dependency unit for the three fixed contracts and executes the public construction and codec observations.
Without that switch, native builds allow newer compatible compilers.

## Limits

The emitter reports each of these at the declaration and generates nothing.

| Limit                                                                                              | Affected                                                         |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `unixTimestamp` encoding                                                                           | C#, Rust                                                         |
| `@pattern` outside the safe common profile below                                                   | All, including Rust-only generation                              |
| `@pattern` within that profile                                                                     | Rust also requires an equivalent in `regex`                      |
| `@pattern` within that profile whose estimated .NET non-backtracking automaton exceeds 10000 nodes | C#                                                               |
| `@preserveLexical` on a boolean or bytes scalar                                                    | Rust                                                             |
| An HTTP method outside the nine standard methods                                                   | Rust                                                             |
| A nullable parameter placed in the path, the query, or a header                                    | All                                                              |
| A nullable raw binary body                                                                         | All                                                              |
| Two distinct numbers beyond the binary64 range referenced through a `const` or an alias            | All, because TypeSpec 1.17 does not expose their source spelling |

A top-level bytes request body is sent as raw bytes.
To send bytes as JSON, put a bytes field inside an object body, such as `model Upload { data: bytes; }`; the body is JSON and the field uses its declared wire encoding.

A nested number beyond the binary64 range inside `@providerDefault`, as in `#{n: 9007199254740993}`, stops the TypeSpec 1.17 compiler before the emitter runs.

### Safe pattern profile

`@pattern` is an optional capability with a closed subset of ECMAScript Unicode (`u`) semantics and no other flags.
This restriction applies to the common authoring profile, not only to the TypeScript backend: a pattern that Rust could execute can still be rejected before Rust-only generation.
Rust and C# retain their additional target-specific restrictions.

The profile admits Unicode scalar literals and escapes (including correctly paired surrogate escapes), concatenation, alternation including empty alternatives, ordinary/noncapturing/named groups, and greedy or lazy `?`, `*`, `+`, and counted quantifiers within the engine's compilation limits.
Capture names and captures are erased because validation exposes only a boolean result.
It also admits strict non-multiline `^` and `$`, dot, character classes and ranges, class unions and complements (including empty and negated-empty classes), and `\d`, `\D`, `\w`, `\W`, `\s`, `\S`.
Dot excludes exactly LF, CR, U+2028, and U+2029; digits are ASCII `0–9`, and word characters are ASCII letters, digits, and underscore.
Whitespace is exactly U+0009–000D, U+0020, U+00A0, U+1680, U+2000–200A, U+2028–2029, U+202F, U+205F, U+3000, and U+FEFF; uppercase escapes complement the corresponding sets.
There is no Unicode normalization or implicit full-string matching: source `a` matches `"ba"`, while `^a$` does not match `"a\n"`.

Backreferences, all lookarounds, word-boundary assertions (`\b`, `\B` outside classes), Unicode property escapes, inline flag modifiers, isolated-surrogate literals, and any other unsupported syntax are rejected.
Engine compilation limits also reject otherwise legal expressions such as `a{1001}` and `(a{40}){40}`; they are not input-length limits.
Invalid syntax produces `invalid-pattern`; legal but unsupported patterns produce source-positioned `unsupported-pattern` issues.
These blocking issues prevent publication of every selected output, before default normalization, default validation, or finite-domain evaluation.
Direct TypeScript rendering also rejects ineligible patterns with `typescript-pattern`.

Generated TypeScript uses synchronous RE2JS matching against the original string, compiling each distinct pattern source once per generated module and calling `.test`, not the full-match `.matches` API.
Generator-owned default and literal/enum domain checks use the same safe executor; none of these paths executes authored patterns through native `RegExp` or falls back to it.
For a fixed admitted pattern, this removes catastrophic backtracking, but does **not** bound total work across arbitrarily large input, many fields, or many patterns.
Host request limits, scheduling, and resource budgets remain host responsibilities.
This guarantee starts at the generator-owned profile/execution boundary.
Before the emitter's preflight, TypeSpec 1.17.0's `@pattern` decorator constructs native `RegExp(pattern)` to check syntax and stores the original source; that decorator does not perform matching.
Replacing generator-owned matching therefore does not remove frontend native regex parsing or establish an end-to-end resource bound for arbitrary hostile compiler input.

Generated C# matches the original string with a `RegexOptions.NonBacktracking` `Regex`, built once per distinct pattern source in a static field of `Wire`.
Matching is a partial `IsMatch`, and `^` and `$` translate to `\A` and `\z`, so `^a$` does not match `"a\n"`.
Direct C# rendering also rejects a pattern that fails the common profile, as `unsupported-csharp`.
.NET reads UTF-16 code units, so the generator translates the pattern again from the shared syntax tree: literals and character sets become expressions in which supplementary planes are surrogate-pair alternatives.
A pair is never split into two matches, and dot and complements read one code point at a time.
A string with an unpaired surrogate is rejected as a `format` violation by the code-point check that runs before the pattern, so no expression reads an unpaired surrogate.
Lazy markers do not change a boolean result and are dropped.
A group with an empty alternative is written as an optional group of the other alternatives, because .NET's tree reduction otherwise drops the lower bound of `(?:a+|)+` and rejects empty input.
Authored patterns are never run by a backtracking engine, and there is no fallback to one.
For a fixed admitted pattern, this removes catastrophic backtracking, but does **not** bound total work across arbitrarily large input, many fields, or many patterns.

Before it builds a non-backtracking matcher, .NET estimates the size of its automaton and throws `NotSupportedException` above its default limit of 10000 nodes.
The generator computes an upper bound of the same estimate and rejects a larger expression at its declaration as `unsupported-csharp`, for C# generation only.
The estimate is the number of literals and character sets after counted repetitions are written out, plus one, multiplied by five when the expression contains `^` or `$`.
A BMP literal and a character set without supplementary planes count as 1, and a supplementary literal counts as 2.
A character set that includes supplementary planes counts 1 for its BMP part, if any, and 2 for each surrogate-pair alternative, so dot counts as 3.
`?` and `*` count their body once, `+` twice, `{n}` and `{m,n}` n times, and `{m,}` m + 1 times.
Therefore `^.{666}$` and `^[a-z]{1000}$` are accepted, while `^.{667}$` and `^(?:ab){1000}$` are rejected.
.NET can shrink the estimate by merging alternatives, so some rejected expressions could still be built by .NET itself.
A host that lowers the AppContext value `REGEX_NONBACKTRACKING_MAX_AUTOMATA_SIZE` below 10000 can make the construction of an accepted expression fail, so it must not.

After checking a value's kind, applicable codepoint-length and UUID checks may suppress the pattern check for that same value.
Their violations remain, and siblings and independent fields continue to be checked; not every failing rule on one value is promised a separate violation.
An executed pattern mismatch remains a `format` violation.
Pattern validation uses the common result algebra: success carries the accepted value and unknown-member diagnostics; failure retains violations and already collected diagnostics without a partially accepted value.

The internal model and JSON Schema/OpenAPI projections retain the original ECMAScript source, not the translated RE2JS expression.
External schema validators own their execution safety; the generated runtime's guarantee does not transfer to them.
Verify browser and Tauri compatibility in the target environment with the generated consumer and its required dependencies installed.

The IPC binding is a request and a response over a transport that the host supplies.
Its fixtures include generic separate-process transports and a [real Tauri/Wry webview](./tests/fixtures/tauri/README.md) with generated TypeScript consumers and Rust provider dispatch.
That desktop fixture targets Linux with GTK3 and WebKitGTK 4.1; it is not a claim of acceptance on Windows, macOS, or mobile.

## Verification

From the repository root, `npm run verify` checks a commit-sized unit: build, types, format and lint, module boundaries, Small tests, and local compiler and publication acceptance.
Before pushing or preparing a release, run `npm run verify:push` in the prepared development environment.
It reuses matching per-check evidence and runs the missing checks, including real generated TypeScript, C#, Rust, and WebView acceptance; missing required tools fail instead of skipping tests.
Native C# preparation audits the dependency package graph online and records its package hashes for isolated acceptance; refresh this point-in-time audit with `npm run audit:native` before release verification.
`npm test` rebuilds and runs every test collection through its size runner without evidence reuse.
There is no separate `verify:full` alias for the same suite.
[CONTRIBUTING](./CONTRIBUTING.md#検証) describes preparation, test sizes and their sandboxed runners, evidence invalidation, and resource limits.

## Architecture standard

The architecture standard is at `/home/nixos/environment/architecture-standard`.
Conformance is always judged against the current text of the standard.
The current contracts and reader-facing documents start at this README.

## License

MIT
