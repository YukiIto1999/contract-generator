import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect } from "vite-plus/test";
import { createTester, mockFile } from "@typespec/compiler/testing";
import type {
  ContractModel,
  EmissionOptions,
  GeneratedFile,
} from "../../../../src/model/contract-model.js";
import { compileContract } from "../../../../src/profile/compile-contract.js";
import { $decorators, $lib } from "../../../../src/profile/library.js";
import { rustFixtureFiles, type FixtureName } from "../../../fixtures/rust/materialize.js";
import { field, repository } from "./protocol.js";
import { requireRustToolchain } from "./toolchain.js";

/** Rust compiler diagnostic of a path package */
export interface CompilerMessage {
  readonly level: string;
  readonly code: string | null;
  readonly rendered: string;
  readonly source: string;
}

/** Temporary checkout of written crates and the Cargo output directory of their builds */
export interface Checkout {
  /** Temporary directory owning the checkout and every output file */
  readonly base: string;
  /** Temporary checkout owning generated products and fixtures */
  readonly root: string;
  /** Cargo output directory shared by every build of this contract */
  readonly target: string;
}

/** Materialized and built native fixture crates for one contract */
export interface Native extends Checkout {
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

/** Installed package manager identity for native acceptance */
export const cargoVersion = requireRustToolchain();

/** Contract source interpreted through the real compiler with the decorators of this checkout
 * @param source - Checkout-relative path that the source text is compiled as, which resolves its imports
 * @param namespace - Selected public contract
 * @param contract - TypeSpec source text
 * @returns Normalized contract
 * @throws Error when the compiler or the profile refuses the contract
 */
export async function modelFrom(
  source: string,
  namespace: string,
  contract: string,
): Promise<ContractModel> {
  const declarations = await readFile(join(repository, "lib/main.tsp"), "utf8");
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
  return normalized.value;
}

/** Rust integration options of a contract
 * @param namespace - Selected public contract
 * @param prefix - Generated crate prefix
 * @returns Options that select the Rust target only
 */
export function rustOptions(namespace: string, prefix: string): EmissionOptions {
  return {
    targets: ["rust"],
    rustCratePrefix: prefix,
    csharpNamespace: namespace,
    typescriptEffectModule: undefined,
  };
}

/** Fixed contract interpreted through the real compiler with the decorators of this checkout
 * @param fixture - Fixed contract name
 * @returns Normalized contract and its integration options
 * @throws Error when the compiler or the profile refuses the fixed contract
 */
export async function canonicalModel(
  fixture: FixtureName,
): Promise<{ readonly model: ContractModel; readonly options: EmissionOptions }> {
  const [source, namespace, prefix] = contracts[fixture];
  const contract = await readFile(join(repository, source), "utf8");
  return {
    model: await modelFrom(source, namespace, contract),
    options: rustOptions(namespace, prefix),
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
 * @param native - Checkout owning the crates
 * @param args - Cargo arguments
 * @param json - Request Cargo's machine-readable diagnostics
 * @returns Complete process outcome
 */
export function cargo(
  native: Checkout,
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
 * @param native - Checkout owning the crates
 * @param subcommand - Cargo subcommand
 * @param args - Remaining Cargo arguments
 * @returns Cargo stdout
 */
export function cleanCargo(native: Checkout, subcommand: string, args: readonly string[]): string {
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

/** Generated files written to a temporary checkout
 * @param prefix - Generated crate prefix
 * @param files - Complete generated and fixture files with paths relative to the checkout
 * @returns Checkout without any build
 */
export async function writeCheckout(
  prefix: string,
  files: readonly GeneratedFile[],
): Promise<Checkout> {
  const base = await mkdtemp(join(tmpdir(), `contract-rust-${prefix}-`));
  const root = join(base, "checkout");
  const shared = process.env.RUST_CONTRACT_TARGET_DIR;
  const target = shared === undefined ? join(base, "target") : join(shared, prefix);
  for (const file of files) {
    const path = join(root, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
  return { base, root, target };
}

/** Fixture crates written to a temporary checkout
 * @param fixture - Fixed contract name
 * @returns Native description without any build
 */
export async function materialize(fixture: FixtureName): Promise<Native> {
  const { model, options } = await canonicalModel(fixture);
  const prefix = options.rustCratePrefix;
  const checkout = await writeCheckout(prefix, rustFixtureFiles(fixture, model, options));
  return {
    ...checkout,
    prefix,
    codec: join(checkout.target, "debug/codec"),
    driver: join(checkout.target, `debug/${prefix}-fixture-driver`),
  };
}

/** Optional network step that populates the Cargo cache for the offline builds
 * @param checkout - Written checkout
 * @param manifests - Cargo manifests of the checkout, relative to it
 */
export function fetchDependencies(checkout: Checkout, manifests: readonly string[]): void {
  if (process.env.RUST_CONTRACT_FETCH !== "1") return;
  for (const manifest of manifests) {
    const fetched = cargo(checkout, ["fetch", "--manifest-path", manifest], false);
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
 * @throws {@link Error} Native build failure after removing the owned temporary checkout
 */
export async function build(fixture: FixtureName, everything = false): Promise<Native> {
  const native = await materialize(fixture);
  try {
    fetchDependencies(native, [
      "rust/Cargo.toml",
      "rust/fixture-codec/Cargo.toml",
      "rust/fixture-driver/Cargo.toml",
    ]);
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
  } catch (failure) {
    await dispose(native);
    throw failure;
  }
}

/** Removal of the temporary files owned by one checkout
 * @param checkout - Written checkout
 */
export async function dispose(checkout: Checkout | undefined): Promise<void> {
  if (checkout !== undefined) await rm(checkout.base, { recursive: true, force: true });
}
