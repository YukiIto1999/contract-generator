import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect } from "vite-plus/test";
import { createTester, mockFile } from "@typespec/compiler/testing";
import type { ContractModel, EmissionOptions } from "../../../../src/model/contract-model.js";
import { compileContract } from "../../../../src/profile/compile-contract.js";
import { $decorators, $lib } from "../../../../src/profile/library.js";
import { rustFixtureFiles, type FixtureName } from "../../../fixtures/rust/materialize.js";
import { field, repository } from "./protocol.js";

/** Rust compiler diagnostic of a path package */
export interface CompilerMessage {
  readonly level: string;
  readonly code: string | null;
  readonly rendered: string;
  readonly source: string;
}

/** Materialized and built native fixture crates for one contract */
export interface Native {
  /** Temporary directory owning the checkout and every output file of this fixture */
  readonly base: string;
  /** Temporary checkout owning generated products and fixtures */
  readonly root: string;
  /** Cargo output directory shared by every build of this contract */
  readonly target: string;
  /** Generated crate prefix */
  readonly prefix: string;
  /** Public-codec observation executable */
  readonly codec: string;
  /** Actual HTTP and IPC observation executable */
  readonly driver: string;
}

/** Source, namespace and crate prefix of each fixed contract */
const contracts: Readonly<Record<FixtureName, readonly [string, string, string]>> = {
  sample: ["tests/fixtures/contracts/main.tsp", "Sample", "sample"],
  wide: ["tests/fixtures/rust/wide/main.tsp", "Wide", "wide"],
  guarantees: ["tests/fixtures/rust/guarantees/main.tsp", "Guarantees", "guarantees"],
};

/** Installed native toolchain identity; absent when Cargo is not on PATH */
const probe = spawnSync("cargo", ["--version"], { encoding: "utf8" });
export const cargoVersion = probe.status === 0 ? probe.stdout.trim() : undefined;
if (cargoVersion === undefined)
  console.warn(
    "Rust native verification NOT RUN: cargo is not available on PATH; enter the pinned toolchain with `devenv shell`",
  );

/** Contract source interpreted through the real compiler with the decorators of this checkout
 * @param fixture - Fixed contract name
 * @returns Normalized contract and its integration options
 * @throws Error when the compiler or the profile refuses the fixed contract
 */
export async function canonicalModel(
  fixture: FixtureName,
): Promise<{ readonly model: ContractModel; readonly options: EmissionOptions }> {
  const [source, namespace, prefix] = contracts[fixture];
  const declarations = await readFile(join(repository, "lib/main.tsp"), "utf8");
  const contract = await readFile(join(repository, source), "utf8");
  const [compiled, diagnostics] = await createTester(repository, { libraries: [] })
    .files({
      "lib/main.tsp": declarations,
      "dist/index.js": mockFile.js({ $lib, $decorators }),
      [source]: contract,
    })
    .import("./lib/main.tsp")
    .using("ContractGenerator")
    .import(`./${source}`)
    .compileAndDiagnose("", { compilerOptions: { noEmit: true } });
  expect(diagnostics.map((diagnostic) => diagnostic.message)).toEqual([]);
  const normalized = compileContract(compiled.program, namespace);
  if (normalized.isErr()) throw new Error(JSON.stringify(normalized.error));
  return {
    model: normalized.value,
    options: {
      targets: ["rust"],
      rustCratePrefix: prefix,
      csharpNamespace: namespace,
      typescriptEffectModule: undefined,
    },
  };
}

/** Diagnostics from Cargo's machine-readable build stream
 * @param stdout - Cargo stdout produced with `--message-format=json`
 * @returns Every compiler diagnostic with its owning crate source
 */
export function compilerMessages(stdout: string): CompilerMessage[] {
  return stdout
    .split("\n")
    .filter((line) => line.startsWith("{"))
    .flatMap((line): CompilerMessage[] => {
      const event: unknown = JSON.parse(line);
      const message = field(event, "message");
      if (
        field(event, "reason") !== "compiler-message" ||
        typeof message !== "object" ||
        message === null
      )
        return [];
      const code = field(message, "code");
      return [
        {
          level: String(field(message, "level")),
          code: typeof code === "object" && code !== null ? String(field(code, "code")) : null,
          rendered: String(field(message, "rendered")),
          source: [field(field(event, "target"), "src_path")]
            .filter((path) => typeof path === "string")
            .join(""),
        },
      ];
    });
}

/** Cargo invocation with isolated intermediate and final build directories
 * @param native - Built fixture owning the checkout
 * @param args - Cargo arguments
 * @param json - Request Cargo's machine-readable diagnostics
 * @returns Complete process outcome
 */
export function cargo(
  native: Native,
  args: readonly string[],
  json = true,
): SpawnSyncReturns<string> {
  return spawnSync("cargo", [...args, ...(json ? ["--message-format=json"] : [])], {
    cwd: native.root,
    encoding: "utf8",
    timeout: 900_000,
    maxBuffer: 1 << 28,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: native.target,
      CARGO_BUILD_BUILD_DIR: join(native.target, "intermediate"),
    },
  });
}

/** Offline Cargo command that must succeed without any warning from a generated or fixture crate
 * @param native - Built fixture owning the checkout
 * @param subcommand - Cargo subcommand
 * @param args - Remaining Cargo arguments
 * @returns Cargo stdout
 */
export function cleanCargo(native: Native, subcommand: string, args: readonly string[]): string {
  const outcome = cargo(native, [subcommand, "--offline", ...args]);
  const warnings = compilerMessages(outcome.stdout)
    .filter((message) => message.source.startsWith(native.root) && message.level === "warning")
    .map((message) => message.rendered);
  expect({
    status: outcome.status,
    stderr: outcome.status === 0 ? "" : outcome.stderr,
    warnings,
  }).toEqual({ status: 0, stderr: "", warnings: [] });
  return outcome.stdout;
}

/** Fixture crates written to a temporary checkout
 * @param fixture - Fixed contract name
 * @returns Native description without any build
 */
export async function materialize(fixture: FixtureName): Promise<Native> {
  const { model, options } = await canonicalModel(fixture);
  const prefix = options.rustCratePrefix;
  const base = await mkdtemp(join(tmpdir(), `contract-rust-${prefix}-`));
  const root = join(base, "checkout");
  const shared = process.env.RUST_CONTRACT_TARGET_DIR;
  const target = shared === undefined ? join(base, "target") : join(shared, prefix);
  for (const file of rustFixtureFiles(fixture, model, options)) {
    const path = join(root, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
  return {
    base,
    root,
    target,
    prefix,
    codec: join(target, "debug/codec"),
    driver: join(target, `debug/${prefix}-fixture-driver`),
  };
}

/** Optional network step that populates the Cargo cache for the offline builds
 * @param native - Materialized fixture
 */
function fetchDependencies(native: Native): void {
  if (process.env.RUST_CONTRACT_FETCH !== "1") return;
  for (const manifest of [
    "rust/Cargo.toml",
    "rust/fixture-codec/Cargo.toml",
    "rust/fixture-driver/Cargo.toml",
  ]) {
    const fetched = cargo(native, ["fetch", "--manifest-path", manifest], false);
    expect({
      manifest,
      status: fetched.status,
      stderr: fetched.status === 0 ? "" : fetched.stderr,
    }).toEqual({
      manifest,
      status: 0,
      stderr: "",
    });
  }
}

/** Fixture crates written and built without warnings
 * @param fixture - Fixed contract name
 * @param everything - Also build each generated crate alone and the whole workspace
 * @returns Built native fixture
 */
export async function build(fixture: FixtureName, everything = false): Promise<Native> {
  const native = await materialize(fixture);
  fetchDependencies(native);
  if (everything) {
    cleanCargo(native, "build", [
      "--manifest-path",
      "rust/Cargo.toml",
      "--workspace",
      "--all-targets",
    ]);
    for (const crate of ["types", "transport", "provider", "client"])
      cleanCargo(native, "build", [
        "--manifest-path",
        "rust/Cargo.toml",
        "--package",
        `${native.prefix}-${crate}`,
      ]);
  }
  cleanCargo(native, "build", [
    "--manifest-path",
    "rust/fixture-codec/Cargo.toml",
    "--all-targets",
  ]);
  cleanCargo(native, "build", [
    "--manifest-path",
    "rust/fixture-driver/Cargo.toml",
    "--all-targets",
  ]);
  return native;
}

/** Removal of the temporary files owned by one fixture
 * @param native - Built fixture
 */
export async function dispose(native: Native | undefined): Promise<void> {
  if (native !== undefined) await rm(native.base, { recursive: true, force: true });
}
