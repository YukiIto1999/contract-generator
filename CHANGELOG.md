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
