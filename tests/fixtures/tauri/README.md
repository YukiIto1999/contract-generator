# Real Tauri webview acceptance

This test-only Linux application closes the gap between a generic process IPC fixture and the actual desktop binding.
The TypeSpec compiler loads this checkout's built emitter, generates TypeScript and Rust from `main.tsp`, and bundles the generated consumer into a real Wry webview.
Tauri registers `contract_request`; it receives the generated consumer's exact JSON text, parses it with the generated Rust `parse_json`, and calls the generated `dispatch_ipc`.
Only the handwritten host owns admission, cancellation, in-memory probe state, and mapping of `ProviderFailure` to Tauri command rejection.
No mock Runtime, copied contract implementation, HTTP development server, application product, authentication system, or external service substitutes for that path.

## Supported environment

The fixture targets Linux x86_64 with GTK3 and WebKitGTK 4.1.
Use the repository's `devenv.yaml` and `devenv.lock`; `devenv.nix` supplies Rust, Cargo, the native build tools, GTK3/WebKitGTK development inputs, GSettings schemas, GIO modules, D-Bus, and `xvfb-run`.
The Rust compiler floor is owned by `src/targets/rust/dependencies.ts::rustMinimumVersion`.
The fixture pins `tauri` 2.12.5, `tauri-runtime-wry` 2.12.3, `wry` 0.57.2 and `tauri-build` 2.7.4 exactly in `materialize.ts`, which is their single declaration; `Cargo.lock` fixes the complete transitive resolution after explicit initial adoption.
Why these versions: the architecture standard follows the latest upstream series (`tools/README.md` item 7), these are the newest stable releases of the 2.x series as published in the crates.io index, and `tauri` 2.12.5 declares Rust 1.90, below the 1.94.0 floor.
Tauri 3.0 exists only as alpha releases and is not adopted, because its required mechanisms and the fixture's behavior on it have not been exercised.
Moving to newer releases is an intentional edit of the pins and the lockfile, followed by new acceptance evidence; availability in a local Cargo cache is never a reason to choose a version.
This is a Linux runtime acceptance target, not evidence for Windows, macOS, mobile, packaging, installers, or updates.

`smoke` creates its own D-Bus session, Xvfb display and `XDG_RUNTIME_DIR`, uses the real GTK/WebKit renderer with software GL and the DMA-BUF renderer disabled for Xvfb, and requires no pre-existing GUI session, loopback network or external network.
`open` instead uses the caller's working X11 or Wayland display and runtime directory, with its own D-Bus session.
Both modes place webview data, cache and configuration (`XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`) inside the temporary checkout, so the fixture does not write to the user's profile.
On WSL2, a working WSLg display can supply the visible window; WSL2 alone is neither a blocker nor proof that a window is usable.
Do not install Rust, npm packages, native libraries, or display servers globally to reproduce this fixture.

## Prepare the emitter and dependency cache

From the repository root, enter the pinned environment and build the actual emitter:

```sh
devenv shell
npm ci
npm run build
export RUST_CONTRACT_TARGET_DIR="$PWD/work/rust-target"
node tests/fixtures/tauri/run.ts prepare
```

Dependency installation and the `prepare` command need network access to the pinned Nix/npm inputs and public Cargo registry dependencies.
`prepare` generates the fixture with the real emitter and fetches its Cargo dependency closure; it does not build or execute the native application.
Ordinary `prepare` requires the tracked `tests/fixtures/tauri/Cargo.lock`, uses `--locked`, and never creates or refreshes a resolution implicitly.
For the first adoption only, explicitly run `node tests/fixtures/tauri/run.ts prepare --create-lock` when the lockfile is absent.
This opts into Cargo's initial transitive resolution under the exact direct pins, writes the complete lockfile, and reports the exact toolchain, GTK/WebKit/libsoup versions, pinned Tauri/Wry crates, and lock SHA-256 as a `fixture-inputs` JSON event.
Inspect and retain that lockfile with the source before recording acceptance; initial resolution is setup, not an acceptance pass.
A dependency change requires an intentional lockfile update and new acceptance evidence.
Expected exit is 0, with the preparation message on stdout; Cargo fetch progress can appear on stderr.
A missing emitter build, unavailable dependency, or invalid lockfile is a failed prerequisite, not a skipped test.

`RUST_CONTRACT_TARGET_DIR` is optional and must name a directory the caller owns.
It preserves compiled dependencies at `<dir>/tauri`; the runner never deletes that cache.
Without it, all compiled outputs belong to the temporary checkout and are removed at exit.
The runner also removes its temporary generated source and terminates only process groups it creates, including interrupted Xvfb/native launches.

## Run offline acceptance

From the same environment and repository root:

```sh
node tests/fixtures/tauri/run.ts smoke
```

This command regenerates the actual products, typechecks the real generated TypeScript consumer, bundles the webview, builds the native application with `cargo build --offline --locked`, and checks that Cargo resolves exactly one Tauri webview runtime: `tauri-runtime-wry`.
It then starts the real application under an owned D-Bus/Xvfb session.
No network fetch occurs during acceptance.
Missing Cargo cache entries, pkg-config libraries, D-Bus, Xvfb, or failed webview startup fail the command rather than selecting a mock or skipping the scenario.

The independently specified observations are:

| Input or transition                                                        | Required observation                                                                                             |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Generated call before readiness                                            | Host unavailable; no handler entry or write                                                                      |
| Four supplementary-plane Unicode characters with omitted amount            | Exact label returned; provider default 2; total 2; one write; client wire input still omits amount               |
| Explicit amount 3                                                          | Total 5; two writes                                                                                              |
| `deny`                                                                     | Generated consumer returns declared `Refused` / `blocked` rejection                                              |
| Untrusted wire amount `null` and 4 sent directly to the registered command | Generated provider rejects `/amount` with `null` and `maximum`; no handler entry                                 |
| Unknown command                                                            | Host reports not found; no handler entry                                                                         |
| Generated inspection after refusals                                        | Total 5; two writes; last committed label unchanged                                                              |
| `hold`, then stop after the handler's event-driven acknowledgement         | Original request returns cancellation after owned cleanup; zero active requests; one cancelled handler; no write |
| New request after stop                                                     | Host unavailable; no extra handler entry                                                                         |
| Actual Wry event-loop shutdown                                             | `host-exit` reports the previously accepted scenario                                                             |

Successful stdout contains `webview-result` with `passed: true`, the nine named checks, `total: 5`, `writes: 2`, `entered: 4`, `active: 0`, and `cancelled: 1`, followed by `host-exit` with `passed: true`.
The wrapper also requires actual subprocess exit 0 and both events; an expected-looking string cannot hide a failed build, native crash, timeout, or premature window closure.
Build and platform diagnostics remain on their original stdout/stderr streams.
The real runtime has a finite 60-second safety bound after the build; a timeout is not a pass.
The root T2 verification entry includes `tests/integration/medium/tauri-webview.test.ts`, which checks the exact structured evidence.

## Inspect the actual window

With an accessible local display, use the same source and scenario:

```sh
node tests/fixtures/tauri/run.ts open
```

The window title is **Generated contract · real Tauri IPC**.
The real webview shows each observation and the final PASS or FAIL result; success evidence is also streamed to stdout while the window remains open for inspection or a screenshot.
Inspect the Unicode payload, totals, refusal feedback, boundary rejections, and shutdown/cancellation observations in that window.
Close only this fixture's window normally to finish `open`; the runner then checks `host-exit` and exits 0.
Closing before successful acceptance, terminating the process, or reaching its finite safety bound is not successful visual acceptance.
A screenshot of a normal browser loading the HTML without the Tauri host is not evidence for this scenario.

These instructions specify expected results, not a claim that a particular checkout has passed them.
Record the actual source, lockfile, environment, separate output streams, exit status, runtime result, and any inspected window evidence when running the coordinated acceptance.
