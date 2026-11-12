# Changelog

This project follows [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- TypeSpec authoring profile for public operations, named outcomes, nominal roles, provider defaults, and HTTP and IPC bindings.
- C#, Rust, and TypeScript generation of public types, validated construction, codecs, provider acceptance and dispatch, and HTTP and IPC consumers.
- Reference projections to JSON Schema, OpenAPI, and Markdown.
- Output publication that replaces the whole generated tree, refuses unowned or hand-edited output, restores the previous output when an earlier replacement was interrupted, and has a read-only drift check.

### Fixed

- Generated C# projects now use exhaustive closed-type switches and ship `csharp/Contract.Analysis.props`; every consumer imports that same analyzer attachment and error policy so omitted variants fail compilation without adding analyzer assemblies to runtime dependencies.
