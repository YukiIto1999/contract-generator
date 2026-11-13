# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- TypeSpec authoring profile for public operations, named outcomes, nominal roles, provider defaults, and HTTP and IPC bindings.
- C#, Rust, and TypeScript generation of public types, validated construction, codecs, provider acceptance and dispatch, and HTTP and IPC consumers.
- Reference projections to JSON Schema, OpenAPI, and Markdown.
- Output publication that replaces the whole generated tree, refuses unowned or hand-edited output, restores the previous output when an earlier replacement was interrupted, and has a read-only drift check.
- A real Linux Tauri/Wry webview acceptance fixture connects generated TypeScript consumers to generated Rust provider dispatch, including provider defaults, declared rejection, invalid wire input, state preservation, cancellation, and orderly shutdown.

### Changed

- **Breaking:** `@pattern` now accepts only the safe common ECMAScript Unicode subset documented in the READMEs and specification. This narrows Rust-only generation too, even where Rust's engine could handle an expression; C# still rejects patterns, and Rust retains its additional target restrictions. Replace unsupported expressions with equivalent admitted patterns before regenerating; unsupported source blocks all selected outputs rather than silently weakening validation.
- Applications consuming pattern-bearing TypeScript modules must declare the exact direct runtime dependency `"re2js": "2.10.0"`; the generator's transitive dependency is not sufficient. Pattern-free modules do not import it, and `@eslint-community/regexpp` 4.12.3 remains generator-only.
- Generated TypeScript codecs now use stack-safe synchronous construction, decoding, provider defaults, and encoding without a contract-level nesting limit. Exact numeric support remains in `lossless-json`; complete-document parsing additionally requires `@streamparser/json` 0.0.26.
- **Breaking:** TypeScript construction, decoding, wire acceptance, and provider acceptance now return `BoundaryRejection` with separate `violations` and `diagnostics` collections. Callers must replace violation-array access with `error.violations`; failed inputs now retain unknown-member observations without their values. Encoding and wire projection keep their existing violation-array error type.
- **Breaking:** JSON acceptance rejects duplicate object member names even when values match, leading BOMs at both text and byte entrypoints, invalid UTF-8, and unpaired UTF-16 surrogates. Embedded U+FEFF, well-formed characters, and exact numeric spellings remain unchanged.
- **Breaking:** C# object and provider-accepted models are sealed get-only classes with reference equality; arrays use nominal immutable `<ArrayName>Codec.Value` wrappers with invalid default state. Regenerate consumers, construct values through the generated factories, and remove assumptions about deep record equality or object `with` cloning. Codecs, defaults, and composite value observations remain stack-safe without a contract depth quota.
- **Breaking:** Rust IPC dispatch and transport now exchange complete JSON `String` values rather than a public parser DOM. Pass the original text through host and Tauri boundaries without parsing it first. Recursive values use immutable shared ownership with stack-safe codecs, defaults, equality, debugging, cloning, and destruction; the generated README specifies the separate declaration-derived compiler recursion allowance required in consumer crate roots.

### Security

- Generated TypeScript pattern checks and generator-owned default and finite-domain checks use synchronous RE2JS execution after exact, fail-closed subset translation, with no native authored-pattern matching or fallback. This removes catastrophic backtracking for a fixed admitted pattern, not unbounded total work across arbitrary input sizes or schemas. Before emitter preflight, TypeSpec 1.17.0's `@pattern` decorator still constructs native `RegExp(pattern)` for syntax checking without matching; frontend parsing and host resource budgets remain outside this guarantee.
- Same-value codepoint-length or UUID failures can skip that value's pattern check while retaining those violations and continuing independent fields. Pattern mismatches remain `format` violations; exhaustive same-value violations are not promised, and pattern validation uses the common boundary rejection type.
- Original pattern source remains in the internal model and schema projections. External validators own their execution safety; adopting this engine does not establish actual browser or Tauri integration verification.

### Fixed

- Concurrent generators now refuse ownership conflicts instead of racing output replacement or recovering an active publisher's backup; read-only checks do not acquire ownership, and abandoned ownership requires verified manual recovery.
- Generated C# projects now use exhaustive closed-type switches and ship `csharp/Contract.Analysis.props`; every consumer imports that same analyzer attachment and error policy so omitted variants fail compilation without adding analyzer assemblies to runtime dependencies.
- Generated C# provider and client projects now attach the dependency's EffectSystem analyzer; `csharp/Contract.EffectAnalysis.props` supplies the same build-time checks to effect consumers.
- Generated effect consumers also treat `EFFSYS014` and `EFFSYS015` as errors, rejecting a competing deadline timer or replacement of an incoming deadline at native consumer compilation.
- C# setup instructions now pass dependency paths to referenced projects explicitly.
- Split verification into fast commit acceptance (`verify`) and evidence-reusing native push acceptance (`verify:push`), with exhaustive test classification, Small and Medium tests run in network-, process- and filesystem-restricted runners, required-tool failures instead of skipped native tests, and whole-tier resource ceilings.
- Native verification retains Nix host-target wrapper markers along with compiler and linker flags, so sanitized Medium runners can resolve the same native libraries as the pinned development shell.
- Native C# preparation now audits the dependency package graph online, checks NuGet's reported audited-project counts, and records exact package versions and archive hashes. Isolated per-fixture restores rely on that point-in-time audit only when every resolved package matches it; unavailable or incomplete audits, advisories, suppressed audit settings, and unaudited packages fail instead of depending on an expiring ambient HTTP cache. Release preparation refreshes the audit before acceptance.
- Generated C#, Rust and TypeScript now keep contract descriptions, wire names, discriminator tags and string values as data: no line end or control character in a description or tag can leave its documentation comment or add code to the generated source, characters that XML or a comment cannot hold and the Unicode direction controls are spelled `\u{XXXX}` in documentation and escaped in literals, C# string literals escape NEL, LS and PS, Rust string literals keep text such as `\u0041` and the backspace and form-feed characters exactly, and the generated Rust crates run no doctests, so a fenced code block in a description is never compiled or executed.
  Rust HTTP placement structs use the same documentation escaping for encoded JSON member names.
- Generated Rust manifests now require 1.94.0, the pinned native acceptance compiler, instead of advertising unexercised 1.85 support; the existing native Rust acceptance collection proves the exact minimum when run with `RUST_CONTRACT_EXACT_MINIMUM=1`, while general native builds allow newer compatible compilers.
- Generated HTTP clients in all three languages now return a communication failure before sending when a path value is empty, `.` or `..`, or when a header value holds a control character other than a horizontal tab, and they never send a request outside the configured origin. The C# client previously sent such header values unvalidated, and the TypeScript client threw a `TypeError` for them.
- Route templates with an empty segment other than a trailing slash, a `.` or `..` segment in any percent-encoded spelling, a backslash, or a placeholder that does not fill a whole segment are now rejected at generation.
- The emitter keeps its declared runtime dependencies external to the published bundle rather than embedding third-party code without its accompanying license notices. The generated TypeScript parser remains a direct consumer dependency, not an emitter runtime dependency.
