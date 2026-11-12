# Rust generated-contract fixtures

These are test-only consumers of the generated Rust APIs. `materialize.ts` renders a fixed contract and adds two native crates per contract: `fixture-codec` (types and `serde_json` only) and `fixture-driver` (the generated transport, provider and client crates, axum, reqwest with rustls and Tokio).

Three fixed contracts exist. Each has literal Rust driver sources that spell the generated names directly, so a change to the generator's naming is a visible failure rather than a value both sides compute:

| Directory                           | Contract                                                                                                                                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `../contracts/main.tsp` + `sample/` | Namespace `Sample`: roles, exact decimals and timestamps, unions, a bytes result and a provider default. `sample/construction.rs` holds the public constructor regressions and `sample/probes/` the compile-only probes.                                                    |
| `wide/`                             | Namespace `Wide`: path, query and header placements, a raw binary request body, results selected by header values, declared 502/503 rejections, every scalar kind and a default beyond the safe-integer range.                                                              |
| `guarantees/`                       | Namespace `Guarantees`: provider defaults at every depth, bytes, string-encoded and week-duration defaults, bytes under a JSON media type, a bodyless result beside a JSON result, recursive types, a header without a wire form, numeric scalars that keep their spelling. |

A fourth contract, namespace `SourceData`, has no operations and builds only the types crate with `fixture-codec`. `source-data/codec.rs` is its only literal Rust source. `tests/integration/medium/rust-source-data.test.ts` writes the TypeSpec inline from `hostile-source.ts` instead of reading a `.tsp` file, because its descriptions, wire name, closed values and tag carry NEL, LS, PS, CR, direction controls and control characters that a source file would hide in diffs. The test builds the crates and their documentation without a warning, reads the rustdoc pages for the descriptions, runs `cargo test` to show that a fenced block in a description is not run as a doctest, and observes the closed values and the hostile tag through the public codec. The same contract is generated for C# (`csharp-source-data.test.ts`) and TypeScript (`typescript-target.test.ts`).

`common/` holds the driver infrastructure shared by all contracts. The fixture manifests rename the generated crates to `types`, `transport`, `provider` and `client`, so the shared sources and the per-contract `contract.rs` (adapter and operation dispatch) and `codec.rs` (public codec observations) use one set of crate names. Expected values live in the vitest files under `tests/integration/medium/rust-*.test.ts`; the drivers only call generated code and print what it returned.

`http-peer.mjs` is a raw TCP peer for deliberate HTTP protocol faults and request capture, not an alternative contract implementation.

## Host policy

The generated provider answers only declared results. `dispatch_http` and `dispatch_ipc` return `ProviderFailure` for invalid input, an unpublished route or command, an interrupted request body and cancellation, and the fixture host in `common/host.rs` decides the response: 400 with the violations, 404 for an unknown operation, 503 for communication, 499 for cancellation. The host also owns the IPC child process, the HTTP deadline and the `CommunicationFailure` it reports when a deadline expires.

## Call driver

`fixture-driver call` reads one JSON line per call and prints one observation line. The host options of a call are ordered by events, never by delays: `cancelBefore` cancels the token before the call, `cancelAfterResult` cancels it only after the call future returned its result (the observation stays the obtained result), and a reply with `hold: true` is never given, so only a host cancellation or the host deadline (`deadlineMs`) ends the call. A `{"cancel":true}` line on the same standard input raises the host cancellation of the call in flight; the tests send it only after observing that the peer holds the request, which is the `request` line of the raw HTTP peer or the provider-side acceptance record on the driver's standard error.

## Dependencies and compiler

Generated product manifests own the exact direct versions in `src/targets/rust/dependencies.ts::rustDependencies`. In particular, `serde_json` must retain `arbitrary_precision`; a binary64 JSON parser is not interchangeable.

The integration compiler is rustc/cargo **1.94.0** from the Nixpkgs revision pinned in `devenv.yaml`; enter it with `devenv shell` from the repository root.
`src/targets/rust/dependencies.ts::rustMinimumVersion` owns the supported compiler floor and supplies every generated manifest and generated Rust README.
The floor is **1.94.0**, rather than an older compiler inferred only from edition 2024.
This is a tested-support policy, not a claim that every older compiler is incapable of compiling the output or that a frozen Nix pin automatically tracks new stable releases.
General native acceptance requires that version or a newer compatible compiler.
The minimum-version proof is this same collection run once with `RUST_CONTRACT_EXACT_MINIMUM=1`, under which `native.ts` fails every suite unless rustc and Cargo are exactly 1.94.0; no separate suite repeats the builds.
Evidence from a newer compiler is never evidence for the minimum.

## Lints

The generated workspace defines the lints of the Rust standard (`warnings`, `unsafe_code`, `missing_docs` and clippy `unwrap_used`, `expect_used` and the documentation lints as errors) and every generated crate inherits them. The devenv shell provides clippy, and the suite runs `cargo clippy` over every generated workspace.

## Verification

From the repository root inside `devenv shell`:

```sh
npm exec vp -- test run src/targets/rust tests/integration/medium/rust-
```

Each test file materializes the contracts it needs into a temporary directory, builds with the existing Cargo cache via `--offline` and removes the temporary files and processes it owns. Every Cargo build uses `--message-format=json`; any warning from a generated or fixture crate fails the suite. `rust-native-build.test.ts` builds each generated crate alone, compares `cargo tree` against the dependency contract, reports each public constructor regression as its own test and runs the compile-only probes.

A missing or unsupported rustc/Cargo toolchain and a missing cache dependency are prerequisite failures, never skipped tests.

Environment switches, all optional:

- `RUST_CONTRACT_FETCH=1` runs `cargo fetch` for the manifests of each fixture before the offline builds. This is the single network step; run it once to populate `CARGO_HOME`.
- `RUST_CONTRACT_TARGET_DIR=<dir>` keeps Cargo's output in `<dir>/<prefix>` instead of the temporary checkout, so repeated runs reuse compiled dependencies. The suite never deletes it.
- `RUST_CONTRACT_EXACT_MINIMUM=1` demands rustc and Cargo equal to `rustMinimumVersion` instead of that version or newer.

The [real Tauri fixture](../tauri/README.md) adds a Wry webview-to-host path; the generic process IPC fixtures here do not stand in for a desktop runtime.
