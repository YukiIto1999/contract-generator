# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- TypeSpec authoring profile for public operations, named outcomes, nominal roles, provider defaults, and HTTP and IPC bindings.
- C#, Rust, and TypeScript generation of public types, validated construction, codecs, provider acceptance and dispatch, and HTTP and IPC consumers.
- Reference projections to JSON Schema, OpenAPI, and Markdown.
- Output publication that replaces the whole generated tree, refuses unowned or hand-edited output, restores the previous output when an earlier replacement was interrupted, and has a read-only drift check.

### Fixed

- Concurrent generators now refuse ownership conflicts instead of racing output replacement or recovering an active publisher's backup; read-only checks do not acquire ownership, and abandoned ownership requires verified manual recovery.
- Generated C# projects now use exhaustive closed-type switches and ship `csharp/Contract.Analysis.props`; every consumer imports that same analyzer attachment and error policy so omitted variants fail compilation without adding analyzer assemblies to runtime dependencies.
- Generated C# provider and client projects now attach the dependency's EffectSystem analyzer; `csharp/Contract.EffectAnalysis.props` supplies the same build-time checks to effect consumers.
- C# setup instructions now pass dependency paths to referenced projects explicitly.
- Declared a finite verification time budget for the existing full verification entry, based on measured native-test runs.
- Generated C#, Rust and TypeScript now keep contract descriptions, wire names, discriminator tags and string values as data: no line end or control character in a description or tag can leave its documentation comment or add code to the generated source, characters that XML or a comment cannot hold and the Unicode direction controls are spelled `\u{XXXX}` in documentation and escaped in literals, C# string literals escape NEL, LS and PS, Rust string literals keep text such as `\u0041` and the backspace and form-feed characters exactly, and the generated Rust crates run no doctests, so a fenced code block in a description is never compiled or executed.
