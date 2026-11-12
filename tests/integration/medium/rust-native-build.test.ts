import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import {
  build,
  cargo,
  cargoVersion,
  cleanCargo,
  compilerMessages,
  dispose,
  type Native,
} from "./rust/native.js";

vi.setConfig({ testTimeout: 600_000, hookTimeout: 3_600_000 });
const native = test.skipIf(cargoVersion === undefined);
const names = ["sample", "wide", "guarantees"] as const;
const built: Native[] = [];

/** Built sample fixture
 * @returns The sample fixture built by the suite setup
 * @throws Error when the sample fixture has not been built
 */
function sample(): Native {
  const entry = built[0];
  if (entry === undefined) throw new Error("the sample fixture has not been built");
  return entry;
}

beforeAll(async () => {
  if (cargoVersion === undefined) return;
  for (const name of names) built.push(await build(name, true));
});
afterAll(async () => {
  for (const entry of built) await dispose(entry);
});

/** Crates reachable from a manifest
 * @param entry - Built fixture owning the checkout
 * @param manifest - Cargo manifest relative to the checkout
 * @returns Unique crate names from the normal and build dependency graph
 */
function dependencies(entry: Native, manifest: string): string[] {
  const outcome = cargo(
    entry,
    [
      "tree",
      "--offline",
      "--manifest-path",
      manifest,
      "--edges",
      "normal,build",
      "--prefix",
      "none",
    ],
    false,
  );
  expect(outcome.status).toBe(0);
  return [
    ...new Set(outcome.stdout.split("\n").flatMap((line) => /^(\S+) v/.exec(line)?.[1] ?? [])),
  ].sort();
}

native(
  "built the four generated crates, each crate alone, and both fixture crates offline without a warning",
  () => {
    for (const entry of built) {
      for (const crate of ["types", "transport", "provider", "client"])
        expect(
          existsSync(join(entry.root, "rust", crate, "src/lib.rs")),
          `${entry.prefix}-${crate}`,
        ).toBe(true);
      expect(existsSync(entry.codec), entry.prefix).toBe(true);
      expect(existsSync(entry.driver), entry.prefix).toBe(true);
      cleanCargo(entry, "build", [
        "--manifest-path",
        "rust/Cargo.toml",
        "--workspace",
        "--all-targets",
      ]);
    }
  },
);

native(
  "keeps HTTP clients, servers and async runtimes out of the types and codec dependency units",
  () => {
    const forbidden = [
      "tokio",
      "tokio-util",
      "hyper",
      "hyper-util",
      "reqwest",
      "axum",
      "h2",
      "tower",
      "mio",
      "socket2",
      "rustls",
      "http",
      "http-body",
      "futures-core",
      "futures-util",
      "native-tls",
      "openssl",
    ];
    for (const entry of built) {
      const types = dependencies(entry, "rust/types/Cargo.toml");
      expect(types).toEqual(
        expect.arrayContaining([
          "serde_json",
          "num-bigint",
          "regex",
          "base64",
          "bytes",
          "thiserror",
          "serde",
        ]),
      );
      expect(types.filter((name) => forbidden.includes(name))).toEqual([]);
      expect(
        dependencies(entry, "rust/fixture-codec/Cargo.toml").filter((name) =>
          forbidden.includes(name),
        ),
      ).toEqual([]);
    }
  },
);

native("gives the provider and client units their HTTP dependencies independently", () => {
  for (const entry of built) {
    expect(dependencies(entry, "rust/provider/Cargo.toml")).toEqual(
      expect.arrayContaining(["axum", "tokio"]),
    );
    expect(dependencies(entry, "rust/client/Cargo.toml")).toEqual(
      expect.arrayContaining(["reqwest", "tokio"]),
    );
  }
});

/** Cargo test names with their reported status, run once for the sample construction regressions */
let construction: Map<string, string> | undefined;

/** Status of each public constructor regression of the sample fixture crate
 * @returns Test name to reported status
 */
function constructionResults(): Map<string, string> {
  if (construction !== undefined) return construction;
  const entry = sample();
  const run = cargo(
    entry,
    [
      "test",
      "--offline",
      "--manifest-path",
      "rust/fixture-codec/Cargo.toml",
      "--test",
      "construction",
    ],
    false,
  );
  expect(run.stderr).not.toContain("warning");
  construction = new Map(
    [...run.stdout.matchAll(/^test (\S+) \.\.\. (\w+)$/gm)].map((match) => [
      match[1] ?? "",
      match[2] ?? "",
    ]),
  );
  return construction;
}

for (const name of [
  "construction_counts_unicode_code_points",
  "owned_children_move_without_redecode_or_clone",
  "construction_distinguishes_every_presence_state_on_the_wire",
  "construction_rejects_a_discriminator_that_names_another_variant",
  "exact_decimal_construction_keeps_its_lexical_spelling",
  "exact_timestamp_construction_keeps_offset_year_zero_fraction_and_leap_second",
  "acceptance_applies_defaults_only_after_plain_decode",
])
  native(`passes the public constructor regression ${name}`, () => {
    expect(constructionResults().get(name)).toBe("ok");
  });

/** Compiler errors of a probe that must fail to build
 * @param binary - Probe binary
 * @param feature - Feature selecting the probe
 * @returns Error diagnostics of the probe
 */
function failing(binary: string, feature: string) {
  const outcome = cargo(sample(), [
    "check",
    "--offline",
    "--manifest-path",
    "rust/fixture-codec/Cargo.toml",
    "--bin",
    binary,
    "--features",
    feature,
  ]);
  expect(outcome.status).toBe(101);
  return compilerMessages(outcome.stdout).filter((message) => message.level === "error");
}

native("rejects an exchanged nominal role for that reason only", () => {
  const exchange = failing("role_exchange", "role-exchange");
  expect(exchange.map((message) => message.code)).toEqual(["E0308"]);
  expect(exchange[0]?.rendered).toContain("expected `RecordId`, found `RequestId`");
});

native("rejects forging a role through its private field for that reason only", () => {
  const forge = failing("private_forge", "private-forge");
  expect(forge.map((message) => message.code)).toEqual(["E0423"]);
  expect(forge[0]?.rendered).toContain("private fields");
});

native("rejects use of a collection after its ownership transferred for that reason only", () => {
  const transferred = failing("alias_mutation", "alias-mutation");
  expect(transferred.map((message) => message.code)).toEqual(["E0382"]);
  expect(transferred[0]?.rendered).toContain("borrow of moved value: `items`");
});

native("accepts an alias of a role as the same type", () => {
  expect(
    cleanCargo(sample(), "check", [
      "--manifest-path",
      "rust/fixture-codec/Cargo.toml",
      "--bin",
      "role_alias",
    ]),
  ).toContain('"reason":"build-finished","success":true');
});

native(
  "passes clippy with the workspace lints of the Rust standard in every generated workspace",
  () => {
    for (const entry of built) {
      const outcome = cargo(entry, [
        "clippy",
        "--offline",
        "--manifest-path",
        "rust/Cargo.toml",
        "--workspace",
        "--all-targets",
      ]);
      const diagnostics = compilerMessages(outcome.stdout)
        .filter(
          (message) =>
            message.source.startsWith(entry.root) &&
            message.level !== "note" &&
            message.level !== "failure-note",
        )
        .map((message) => message.rendered);
      expect({ prefix: entry.prefix, status: outcome.status, diagnostics }).toEqual({
        prefix: entry.prefix,
        status: 0,
        diagnostics: [],
      });
    }
  },
);
