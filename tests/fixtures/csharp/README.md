# C# generated-code fixtures

These drivers consume the actual generated `Sample` contract with `csharpNamespace: "Sample"`.
A second contract, `features.tsp` with `csharpNamespace: "Features"`, reaches the emitter paths that `Sample` does not: path, query and header parameters, a binary request body, same-status results selected by a header, a declared 503 rejection, a bodyless result at 200, provider defaults below the operation input (nested object, array element and union variant) in bytes, string-encoded boolean and number, duration and date-time form, a request body member that repeats a placed parameter, `int64`, `uint64`, `integer`, `bytes`, `float32`, `float64`, `boolean`, `plainDate`, `plainTime`, `duration`, `utcDateTime`, enumerated, literal and mixed-kind members, optional nullable members and collections.
None of the drivers implements a second validator or an echo transport.
The codec driver references only the generated types project.
The operation driver connects the generated provider to handwritten fixture handlers through a real HTTP listener or an actual child process.
The features driver exchanges real generated client and provider messages through an in-memory loopback and, for client-side classification, against raw TCP peers.

## Source prerequisites

Use .NET 10 and C# 14 with these immutable source revisions:

| Source                                                   | Required commit                                       | MSBuild property                                                            |
| -------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| `https://github.com/YukiIto1999/typemodeling-dotnet.git` | `98a8ac5a2ad4384a18d8fc5cb100dd07cd795a33` (`v0.2.0`) | `TypeModelingProjectPath`, ending in `src/TypeModeling/TypeModeling.csproj` |
| `https://github.com/YukiIto1999/effectsystem-dotnet.git` | `8d07a0e06a16a402d550af8571ed1f025a7df5f5` (`v0.2.0`) | `EffectSystemProjectPath`, ending in `src/EffectSystem/EffectSystem.csproj` |

The source repositories must be writable copies in sibling directories named `typemodeling-dotnet` and `effectsystem-dotnet`.
The EffectSystem source project has relative project references to the sibling TypeModeling runtime and analyzer.
Neither generated code nor fixture projects contain workstation paths or unpublished NuGet package references.
Both MSBuild properties can be supplied explicitly or inherited from the environment; `devenv shell` exports them for the prepared checkouts under `work/native-dependencies`.

The inspected TypeModeling API is `TypeModeling.Domain.Result<TValue,TFailure>` with nested `Succeeded(Value)` and `Failed(Failure)` records.
The inspected EffectSystem API is `EffectContext<TR,TF>.Succeed`, `Fail`, `Defect`, `Sync`, `Try`, `Access`, with `Bind`, `Map`, `MapFailure`, and `Recover` extensions.
The v0.2.0 effect callback receives `CancellationToken`; it has no `Deadline`, `FromResult`, or `AsyncResult` API.
Generated operations therefore receive an explicit nullable `DateTimeOffset` deadline and forward it as metadata without adding a timer.
The injected IPC transport receives the same deadline, and native HTTP handlers can read `ContractClient.DeadlineOption` from `HttpRequestMessage.Options`.
The host owns the actual deadline cancellation token and its termination reason.

Every generated unit and fixture project attaches the existing `TypeModeling.Analyzers` source project as a build-only analyzer (`OutputItemType="Analyzer"`, `ReferenceOutputAssembly="false"`, `PrivateAssets="all"`).
Its path is derived from `TypeModelingProjectPath` relative to the consuming project, so no analyzer-path setting is required.
Exhaustiveness diagnostics (`CS8509`, `CS8524`, `CS8655`, `CS8846`, `CS8847`, and `TYPMOD001`) are errors.
The types-only runtime-dependency test also rejects analyzer and Roslyn assemblies in the output and dependency manifest.

These sources were built and executed with .NET SDK 10.0.201 from `devenv shell`.
The generated units, the three drivers and the accepted role probes compile without any compiler diagnostic of their own; each rejected role probe fails with exactly one `CS0029`.
The dependency projects were built from the same checkouts and reported no diagnostic either.

## Running

From the repository root inside `devenv shell`:

```sh
npx vp test run src/targets/csharp tests/integration/medium/csharp
```

The suite renders the contracts through the real TypeSpec frontend, writes the generated files and a clean copy of this directory into a directory under `$TMPDIR`, runs the `dotnet build` commands below, drives the resulting assemblies, and removes the directory afterward.
It builds with `--disable-build-servers`, so no MSBuild or compiler server is left running.
It fails on any compiler diagnostic that is not located inside one of the pinned dependency checkouts.
Without a runnable `dotnet` 10 or without both project-path variables the native suites are skipped, and a `[csharp-native] NOT RUN:` line names the missing prerequisite.
A skipped suite is not a verification.

## Build inputs and manual commands

Set `GeneratedContractRoot` to the emitter output directory containing `csharp/types`, `csharp/provider`, and `csharp/client`.
The canonical input is `tests/fixtures/contracts/main.tsp`; the second contract is `tests/fixtures/csharp/features.tsp`.
Run the following from the contract-generator root after generating the canonical input and supplying the source-project properties above:

```sh
dotnet build tests/fixtures/csharp/CodecDriver.csproj -p:GeneratedContractRoot="$GeneratedContractRoot"
dotnet build tests/fixtures/csharp/OperationDriver.csproj -p:GeneratedContractRoot="$GeneratedContractRoot"
dotnet build tests/fixtures/csharp/RoleProbe.csproj -p:GeneratedContractRoot="$GeneratedContractRoot" -p:Probe=AliasAccepted
dotnet build tests/fixtures/csharp/RoleProbe.csproj -p:GeneratedContractRoot="$GeneratedContractRoot" -p:Probe=RejectRecordAsRequest
dotnet build tests/fixtures/csharp/RoleProbe.csproj -p:GeneratedContractRoot="$GeneratedContractRoot" -p:Probe=RejectRequestAsRecord
```

The first three commands exit zero with no diagnostic.
The last two fail with exactly one diagnostic each, `error CS0029`: `RecordId` cannot be assigned to `RequestId`, and `RequestId` cannot be assigned to `RecordId`.
`AliasAccepted.Read(Envelope)` returns `envelope.CorrelationId` as `RequestId`, proving the alias retains the original role.
Run the negative probes separately; they are excluded from the executable fixture projects.

For the second contract, generate `features.tsp` with `csharp-namespace` `Features`, then build `FeaturesDriver.csproj` and the probes `FeatureInheritedRoleAccepted` (exits zero: a narrowed scalar yields the ancestor's `CustomerRole`) and `FeatureRejectInheritedAsOther` (one `error CS0029`: `CustomerRole` is not an `OtherCustomer`).

## Closed-hierarchy consumer compilation

`exhaustiveness.tsp` declares a discriminator union, a mixed-kind enumeration, two successes and two declared rejections.
`ExhaustivenessProbe.csproj` references all three generated units and compiles one hand-written consumer from `probes/$(Probe).cs`.
The fixture's `Directory.Build.props` imports the delivered `csharp/Contract.Analysis.props` and, when `EffectSystemProjectPath` is supplied, `csharp/Contract.EffectAnalysis.props`; it does not define separate analyzer references or error policies.
The default `ExhaustiveConsumer` matches every public variant without a catchall, including operation failures, provider failures and the runtime's generic `Result`.
Its executable observes both union and enumeration variants and the ordinary rejection of unknown or null wire inputs.
The `MissingChoice`, `MissingMixed`, `MissingSuccess`, `MissingRejection`, `MissingFailure`, `MissingProviderFailure`, `GuardedChoice` and `OpenExpression` probes are expected to fail with an exhaustiveness error.
`ClosedStatement` is expected to fail with `TYPMOD001`.
`UnconstructedEffect` is expected to fail with `EFFSYS008` when a consumer returns `default` instead of constructing an effect.
These are native consumer compilation tests, not generated-source or project-wiring assertions.

The pinned analyzer does **not** forbid a discard arm in a consumer's switch expression.
Generated closed switches themselves have no catchall; a consumer's catchall still needs review.
The exact pinned evidence is `src/TypeModeling.Analyzers/AnalyzerReleases.Shipped.md:10` (only `TYPMOD001`), `diagnostics/closedunionswitchstatement/ClosedUnionSwitchStatementAnalyzer.cs:29-33` (switch-statement registration), and `suppression/closedunionexhaustiveness/ClosedUnionExhaustivenessSuppressor.cs:65-84` (suppression only for covered `CS8509` and `CS8524`).
Those latter paths are relative to the analyzer source directory in the pinned TypeModeling checkout.
The closed annotation is recognized by its `TypeModeling.Domain.ClosedUnionAttribute` metadata name and nested sealed subclasses (`facts/ClosedTypeSet.cs:10-12,25-43`); the generator already emits that shape.

Run `npx vp test run tests/integration/medium/csharp-exhaustiveness.test.ts` inside `devenv shell` for the focused consumer checks.

## Codec observations

Run the built `CodecDriver.dll` and send one JSON object per input line:

```json
{ "type": "ShortLabel", "payload": "\"😀😀😀\"" }
```

The standard response contains `accepted`, optional `encoded`, `diagnostics`, and `violations` as specified in `work/implementation-brief.md`.
`payload` is raw JSON text for codec cases and a primitive string for `ShortLabelConstruction`.
Supported boundaries are `Envelope`, `EnvelopeConstruction`, `RequestId`, `RecordId`, `ShortLabel`, `ShortLabelConstruction`, `SmallCount`, `ExactDecimal`, `ExactTimestamp`, `Item`, `DefaultRequestId` and `DefaultRequestIdEncode`.
`EnvelopeConstruction` decodes a baseline through `EnvelopeCodec`, calls the generated `Envelope.Create` overload with a mutable `Item[]`, mutates that source array, and encodes the completed generated value.
Optional `label`, `count`, `defaultRequestId` and `nullItems` factory overrides exercise the same generated constraints as decode and the rejection of a zero-valued role and a null collection.

`codec-cases.json` supplies independent expectations for Unicode boundaries (supplementary characters, escaped surrogate pairs, combining and joiner sequences, unpaired surrogate escapes), exact decimal tokens, year zero, leap seconds, invalid calendars and offsets, UUID spelling, variants, missing discriminators, unknown fields, byte decoding, JSON type mismatches, and malformed JSON.
`presence-cases.json` supplies a baseline and independent omission, null, nested-unknown, multiple-violation and mutation expectations.
Compare encoded JSON values rather than escaping choices: System.Text.Json may escape supplementary characters and `+` while preserving their value.
Violations and diagnostics are compared without regard to their order.
The `tests/integration/medium/csharp-*.ts` helper modules provide the observation of the codec driver (`csharp-codec-observation.ts`), the Features expectation tables (`csharp-features-cases.ts`), the process and raw-peer helpers, and one build per contract through `useContract`.
The unsafe numeric tokens of the second contract are checked as exact substrings of the encoded text because `JSON.parse` would round them.

Generated public APIs used by this driver are role factories, scalar `*Codec.Create/Decode/Validate/Encode`, object `Create`, union `Item.Text`/`Item.Binary` validated variants, `EnvelopeCodec.Decode/Encode`, `Presence<T>`, `Accepted<T>`, `ContractFailure`, `Violation`, and `UnknownProperty`.
`ExactDecimal.Text` retains the original token, including scale and exponent spelling; date-time values remain exact validated strings rather than `DateTimeOffset` values.

## Real operation paths

Run the built `OperationDriver.dll --http-server http://127.0.0.1:PORT/` to expose the actual generated provider.
The process prints `ready` after binding the supplied listener address; the caller chooses an available loopback port and owns process shutdown.
The host maps a provider failure that is not a declared outcome to `application/problem+json`: status 400 with `{"failure":"input","violations":[...]}`, 404 with `{"failure":"unknown-operation"}`, otherwise 500.
Run `OperationDriver.dll` without arguments for JSON-lines client observations.
A request has `operation` (`submit` or `download`), `binding` (`direct`, `http`, or `ipc`), `payload` (raw parameter-object JSON text), and an optional HTTP `url`.
For example, `download` with payload `"{}"` exercises a genuinely empty binary success.
For `submit`, the payload is `{"input":<Envelope>,"limit":<optional 1..3>}`.

The handwritten fixture handler selects `Created` for `input.count=1`, `Queued` for `2`, and `Completed` for `3`.
For the first two results its receipt is `limit:N`, exposing provider default application to `3` without client-side repair.
The label `rej` selects the declared rejection; `zzz` introduces a cancellable 200 ms handler wait; `dl` returns the deadline the handler received as `deadline:<ISO instant>` or `deadline:none`; `pid` returns the handler's process id.
The adapter calls generated factories for receipts and rejections rather than recreating validation.

IPC requests start the same executable with `--ipc-worker` in a separate process, pass the generated command and parameters, and return the provider's resolved tagged envelope.
`ProcessTransport` uses native process pipes and token-aware reads, accepts exactly one newline-terminated response line (a missing terminator is a communication failure), and owns killing and draining an interrupted child.
It does not manufacture contract successes.
A provider failure that is not a declared outcome is reported by the worker on standard error as `{"failure":"input","violations":[...]}`, `{"failure":"unknown-operation"}` or another failure kind, with exit code 2 and no standard-output line.
`--ipc-worker --ipc-peer KIND` replaces the generated provider with a hand-written peer; the optional request field `ipcPeer` selects it.
The kinds are `eof`, `garbage`, `truncated`, `unknown-tag`, `void-with-body`, `missing-body`, `wrong-body`, `queued`, `completed`, `rejected` and `downloaded`.
This is generic injected IPC, not a native Tauri application or UI test.

Optional scenario inputs are `cancel:"before"`, `cancel:"after"`, `cancelAfterMs`, an absolute ISO `deadline`, and `deadlineAfterMs` (relative to the moment the scenario starts).
The fixture host owns deadline timers and reports parent cancellation ahead of deadline cancellation.
`cancel:"after"` cancels only after the generated runtime has returned, so its completed result must remain unchanged.
The output carries `httpDeadline` when the generated HTTP client forwarded a deadline in the request options.
The driver can target a real HTTP fault server for undeclared statuses, wrong media types, declared gateway matches and mismatches, and truncated response bodies; `csharp-peers.ts` provides `startRawPeer` and `httpResponse` for hand-written HTTP/1.1 bytes, and `parseRawRequest` for the request the generated client sent.
The output `exit` is `succeeded`, `declared`, `input`, `transport`, `defected`, or `canceled` with the generated case or host-owned reason where applicable.

Generated public operation APIs are `SubmitInput.Create/SubmitInputCodec.Decode`, `SubmitAcceptance.Accept`, `SubmitSuccess.Created/Queued/Completed.Create`, `SubmitRejection.Rejected.Create`, `DownloadInput`, `DownloadSuccess.Downloaded.Create`, `IContractHandlers`, `ContractProvider.Submit/Download/DispatchHttp/DispatchIpc`, `IClientRequirements`, `IIpcTransport`, and `ContractClient.SubmitHttp/SubmitIpc/DownloadHttp/DownloadIpc`.
The effective submission input exposes a required `Limit` while the ordinary input retains `Presence<int>`.
The no-default download operation reuses `DownloadInput` rather than generating a same-guarantee accepted DTO.

## Second contract

`FeaturesDriver.dll` reads JSON lines of three kinds.
`{"type":...,"payload":...,"binding":...}` is the codec protocol for `Numbers`, `ExactInteger`, `ExactAmount`, `ExactOffset`, `NonemptyCustomer`, `Kinds` and `MergeRequest`, whose payload carries the placed parameters text and the request body text of the `merge` operation.
`{"operation":"choose"|"route"|"upload"|"image"|"ping",...}` runs the generated client; without `url` it dispatches into the generated provider through an in-memory handler that records the request the client sent and the response the provider produced, and with `url` it talks to a raw TCP peer.
`{"operation":"provider","method":...,"target":...,"headers":...,"contentType":...,"body":<base64>}` hands a hand-written request to `ContractProvider.DispatchHttp`.
`{"operation":"providerIpc","command":...,"parameters":...}` hands a hand-written command to `ContractProvider.DispatchIpc`, and `{"operation":"direct","payload":...}` calls the generated provider directly for the defaults operation.
The `defaults` handler reports the effective branch through the public properties that a handler reads.
`UnixInstant` with an `unixTimestamp` binding and a model named like a generated operation type are rejected at generation with source-addressed issues, which `csharp-diagnostics.test.ts` and `src/targets/csharp/render-csharp.test.ts` assert without needing `dotnet`.

## Not exercised

- A native Tauri application or UI; IPC is the generic injected transport over a child process.
- A bodyless result that carries a body behind a 204: `HttpClient` discards the body of a 204, so the bodyless selection rule is exercised at 200 with `Features.ping`.
- A declared 502, 503 or 504 rejection in the `Sample` contract (it declares 400 and 404). The declared-503 match and mismatch are exercised only for `Features.choose`, with raw TCP responses to the generated client and the in-memory loopback for the provider.
- The `Features` provider over a real socket and the `Features` IPC client binding at run time (they compile; the loopback and the raw peers cover the HTTP behavior, and `providerIpc` covers the IPC provider entry of the defaults operation). `Sample` covers real sockets and separate-process IPC.
- Cancellation of the provider-side handler by a dropped HTTP connection: the fixture server passes `CancellationToken.None`, which is a host decision, so only client-side cancellation is observed.
- A request body cut off mid-transfer on the provider side, concurrent requests, large payloads and performance.
- A `Sample` result selected by a header, because the `Sample` contract declares none; the `Features` contract covers header selection for HTTP. IPC results are selected by tag only.
- Duplicate query or header parameters and duplicate object members are rejected by the generated code but have no expectation here because the contract does not specify their rule.
- A default whose profile-accepted constant exceeds the finite range of `float32` or `float64`: the generated reader rejects it as a format violation, so the profile has to reject it.
