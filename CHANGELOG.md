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

### Security

- Generated TypeScript pattern checks and generator-owned default and finite-domain checks use synchronous RE2JS execution after exact, fail-closed subset translation, with no native authored-pattern matching or fallback. This removes catastrophic backtracking for a fixed admitted pattern, not unbounded total work across arbitrary input sizes or schemas. Before emitter preflight, TypeSpec 1.17.0's `@pattern` decorator still constructs native `RegExp(pattern)` for syntax checking without matching; frontend parsing and host resource budgets remain outside this guarantee.
- Same-value codepoint-length or UUID failures can skip that value's pattern check while retaining those violations and continuing independent fields. Pattern mismatches remain `format` violations; exhaustive same-value violations are not promised, and the result algebra is unchanged.
- Original pattern source remains in the internal model and schema projections. External validators own their execution safety; adopting this engine does not establish actual browser or Tauri integration verification.

### Fixed

- Concurrent generators now refuse ownership conflicts instead of racing output replacement or recovering an active publisher's backup; read-only checks do not acquire ownership, and abandoned ownership requires verified manual recovery.
- Generated C# projects now use exhaustive closed-type switches and ship `csharp/Contract.Analysis.props`; every consumer imports that same analyzer attachment and error policy so omitted variants fail compilation without adding analyzer assemblies to runtime dependencies.
- Generated C# provider and client projects now attach the dependency's EffectSystem analyzer; `csharp/Contract.EffectAnalysis.props` supplies the same build-time checks to effect consumers.
- C# setup instructions now pass dependency paths to referenced projects explicitly.
- Declared a finite verification time budget for the existing full verification entry, based on measured native-test runs.
- Generated C#, Rust and TypeScript now keep contract descriptions, wire names, discriminator tags and string values as data: no line end or control character in a description or tag can leave its documentation comment or add code to the generated source, characters that XML or a comment cannot hold and the Unicode direction controls are spelled `\u{XXXX}` in documentation and escaped in literals, C# string literals escape NEL, LS and PS, Rust string literals keep text such as `\u0041` and the backspace and form-feed characters exactly, and the generated Rust crates run no doctests, so a fenced code block in a description is never compiled or executed.
- Generated Rust manifests now require 1.94.0, the pinned native acceptance compiler, instead of advertising unexercised 1.85 support; the existing native Rust acceptance collection proves the exact minimum when run with `RUST_CONTRACT_EXACT_MINIMUM=1`, while general native builds allow newer compatible compilers.
- Generated HTTP clients in all three languages now return a communication failure before sending when a path value is empty, `.` or `..`, or when a header value holds a control character other than a horizontal tab, and they never send a request outside the configured origin. The C# client previously sent such header values unvalidated, and the TypeScript client threw a `TypeError` for them.
- Route templates with an empty segment other than a trailing slash, a `.` or `..` segment in any percent-encoded spelling, a backslash, or a placeholder that does not fill a whole segment are now rejected at generation.
- The emitter keeps its declared runtime dependencies external to the published bundle rather than embedding third-party code without its accompanying license notices.
