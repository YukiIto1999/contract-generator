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

It requires Node 24.11 or later and `@typespec/compiler` 1.17.0.

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
It replaces the whole directory at once, and when a replacement was interrupted it restores the previous output on the next run.
Run it with `check: true` in the verification entry of the consuming repository to detect drift.

## Output

| Path                                                               | Content                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `typescript/contract.ts`                                           | Types, construction, and codecs that depend on `ts-results-es`, `lossless-json`, and `@scure/base` only |
| `typescript/provider.ts`, `typescript/client.ts`                   | Handler interfaces with dispatch, and HTTP and IPC clients                                              |
| `csharp/types/`, `csharp/provider/`, `csharp/client/`              | Three projects, of which the types project references TypeModeling only                                 |
| `rust/types/`, `rust/transport/`, `rust/provider/`, `rust/client/` | Four crates, of which the types crate has no HTTP or async-runtime dependency                           |
| `schemas/`, `http/openapi.json`, `docs/reference.md`               | Reference projections that are not complete validation schemas and are not inputs to generation         |

The generated handler interface is the contract side of the connection.
A hand-written adapter implements it and calls the application, so the application does not depend on generated code.
A generated provider returns invalid input, an unknown operation, and a cancellation to the host as typed results, and the host decides the response.
An unknown-member diagnostic names the containing object by its JSON pointer in `path` and the member in `key`.

## Language integration

### TypeScript

The generated code returns `Result` and `AsyncResult` from `ts-results-es` and does not define an effect type.
The module named by `typescript-effect-module` exports `Effect<Env, E, A>`, callable as `(env, signal, deadlineAt) => AsyncResult<A, E>`, and `deferEffect`, which takes a function of that shape.
`createFetchTransport` forwards the signal and adds no timer.

### C#

The generated projects reference TypeModeling and EffectSystem from source checkouts at their `v0.2.0` tags, placed side by side as `typemodeling-dotnet/` and `effectsystem-dotnet/`.
Pass the project paths as the MSBuild properties `TypeModelingProjectPath` and `EffectSystemProjectPath`.
EffectSystem `v0.2.0` has no deadline type, so each operation takes a `DateTimeOffset? deadline` and passes it on unchanged, and the host owns the timer.

### Rust

The generated crates use the standard `Result` and futures, with `CancellationToken` from `tokio-util` for cancellation.
The host owns the server: it passes each request to `dispatch_http` or `dispatch_ipc` and maps the returned `ProviderFailure` to its own response.
A host that receives IPC text parses it with the generated `parse_json`, which keeps the spelling of numbers.
The manifests carry the lints of the architecture standard and declare Rust 1.85, and the crates are built, linted with clippy, and tested with Rust 1.94.0.

## Limits

The emitter reports each of these at the declaration and generates nothing.

| Limit                                                                                   | Affected                                                                |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `unixTimestamp` encoding                                                                | C#, Rust                                                                |
| `@pattern`                                                                              | C#, and Rust for expressions without an equivalent in the `regex` crate |
| `@preserveLexical` on a boolean or bytes scalar                                         | Rust                                                                    |
| An HTTP method outside the nine standard methods                                        | Rust                                                                    |
| A nullable parameter placed in the path, the query, or a header                         | All                                                                     |
| A nullable raw binary body                                                              | All                                                                     |
| Two distinct numbers beyond the binary64 range referenced through a `const` or an alias | All, because TypeSpec 1.17 does not expose their source spelling        |

A top-level bytes request body is sent as raw bytes.
To send bytes as JSON, put a bytes field inside an object body, such as `model Upload { data: bytes; }`; the body is JSON and the field uses its declared wire encoding.

A nested number beyond the binary64 range inside `@providerDefault`, as in `#{n: 9007199254740993}`, stops the TypeSpec 1.17 compiler before the emitter runs.

The IPC binding is a request and a response over a transport that the host supplies, and it is tested across separate processes.
It is not tested inside a Tauri application.

## Architecture standard

The architecture standard is at `/home/nixos/environment/architecture-standard`.
Conformance is always judged against the current text of the standard.
The current contracts and reader-facing documents start at this README.

## License

MIT
