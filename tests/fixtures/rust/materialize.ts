import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  ContractModel,
  EmissionOptions,
  GeneratedFile,
} from "../../../src/model/contract-model.js";
import { rustDependencies } from "../../../src/targets/rust/dependencies.js";
import { renderRust } from "../../../src/targets/rust/render-rust.js";

/** Fixed contract whose literal Rust driver sources live next to this module */
export type FixtureName = "sample" | "wide" | "guarantees";

/** Compile-only consumer of the generated public boundary whose build outcome is the observation */
interface Probe {
  /** Cargo binary and source file stem */
  readonly binary: string;
  /** Cargo feature that selects a deliberately failing probe */
  readonly feature?: string;
}

/** Compile-only probes of each fixed contract */
const probes: Readonly<Record<FixtureName, readonly Probe[]>> = {
  sample: [
    { binary: "role_exchange", feature: "role-exchange" },
    { binary: "role_alias" },
    { binary: "private_forge", feature: "private-forge" },
    { binary: "alias_mutation", feature: "alias-mutation" },
  ],
  wide: [],
  guarantees: [],
};

/** Fixture source text relative to this directory
 * @param path - Path below the Rust fixture directory
 * @returns File content
 */
function source(path: string): string {
  return readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");
}

/** Manifest of the types-only codec crate
 * @param prefix - Generated crate prefix
 * @param list - Compile-only probes of the contract
 * @returns Cargo manifest text
 */
function codecManifest(prefix: string, list: readonly Probe[]): string {
  const d = rustDependencies;
  const features = list.flatMap((probe) => (probe.feature === undefined ? [] : [probe.feature]));
  const bins = list.map(
    (probe) =>
      `[[bin]]\nname = "${probe.binary}"\npath = "src/bin/${probe.binary}.rs"\n${probe.feature === undefined ? "" : `required-features = ["${probe.feature}"]\n`}`,
  );
  return `[package]\nname = "${prefix}-fixture-codec"\nversion = "0.0.0"\nedition = "2024"\n\n[workspace]\n\n[dependencies]\ntypes = { package = "${prefix}-types", path = "../types" }\nserde_json = { version = "=${d.serde_json}", features = ["arbitrary_precision"] }\n\n[features]\n${features.map((feature) => `${feature} = []\n`).join("")}\n[[bin]]\nname = "codec"\npath = "src/main.rs"\n\n${bins.join("\n")}`;
}

/** Manifest of the actual HTTP and IPC driver crate
 * @param prefix - Generated crate prefix
 * @returns Cargo manifest text
 */
function driverManifest(prefix: string): string {
  const d = rustDependencies;
  const own = ["types", "transport", "provider", "client"]
    .map((unit) => `${unit} = { package = "${prefix}-${unit}", path = "../${unit}" }`)
    .join("\n");
  return `[package]\nname = "${prefix}-fixture-driver"\nversion = "0.0.0"\nedition = "2024"\n\n[workspace]\n\n[dependencies]\n${own}\nserde_json = { version = "=${d.serde_json}", features = ["arbitrary_precision"] }\nreqwest = { version = "=${d.reqwest}", default-features = false, features = ["rustls"] }\naxum = "=${d.axum}"\ntokio = { version = "=${d.tokio}", features = ["full"] }\n`;
}

/** Generated Rust product of a contract
 * @param model - Canonical profile output
 * @param options - Target integration options
 * @returns Generated product files
 * @throws Error when the generator refuses the contract
 */
function generated(model: ContractModel, options: EmissionOptions): readonly GeneratedFile[] {
  const result = renderRust(model, options);
  if (result.isErr()) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/** Generated product plus the literal native consumer crates of one fixed contract
 * @param fixture - Fixed contract name
 * @param model - Canonical profile output
 * @param options - Target integration options
 * @returns Generated product files and test-only native consumer crates
 * @throws Error when the generator refuses the fixed contract, which is itself a failure of the fixture
 */
export function rustFixtureFiles(
  fixture: FixtureName,
  model: ContractModel,
  options: EmissionOptions,
): readonly GeneratedFile[] {
  const prefix = options.rustCratePrefix;
  const list = probes[fixture];
  const construction =
    fixture === "sample"
      ? [
          {
            path: "rust/fixture-codec/tests/construction.rs",
            content: source("sample/construction.rs"),
          },
        ]
      : [];
  return [
    ...generated(model, options),
    { path: "rust/fixture-codec/Cargo.toml", content: codecManifest(prefix, list) },
    { path: "rust/fixture-codec/src/main.rs", content: source("common/codec_main.rs") },
    { path: "rust/fixture-codec/src/codec.rs", content: source(`${fixture}/codec.rs`) },
    ...construction,
    ...list.map((probe) => ({
      path: `rust/fixture-codec/src/bin/${probe.binary}.rs`,
      content: source(`sample/probes/${probe.binary}.rs`),
    })),
    { path: "rust/fixture-driver/Cargo.toml", content: driverManifest(prefix) },
    { path: "rust/fixture-driver/src/main.rs", content: source("common/driver_main.rs") },
    { path: "rust/fixture-driver/src/host.rs", content: source("common/host.rs") },
    { path: "rust/fixture-driver/src/contract.rs", content: source(`${fixture}/contract.rs`) },
  ];
}

/** Generated product plus the types-only codec crate of the source-data contract
 * @param model - Canonical profile output
 * @param options - Target integration options
 * @returns Generated product files and the test-only native codec consumer
 * @throws Error when the generator refuses the contract, which is itself a failure of the fixture
 */
export function rustSourceDataFiles(
  model: ContractModel,
  options: EmissionOptions,
): readonly GeneratedFile[] {
  return [
    ...generated(model, options),
    { path: "rust/fixture-codec/Cargo.toml", content: codecManifest(options.rustCratePrefix, []) },
    { path: "rust/fixture-codec/src/main.rs", content: source("common/codec_main.rs") },
    { path: "rust/fixture-codec/src/codec.rs", content: source("source-data/codec.rs") },
  ];
}
