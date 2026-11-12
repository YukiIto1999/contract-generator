import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import { rustSourceDataFiles } from "../../fixtures/rust/materialize.js";
import {
  declarations,
  flavorValues,
  hostileContract,
  lookalikes,
  memberBreaks,
  oneLine,
  pickJson,
  pickTagOneLine,
  specimenJson,
  wireNameOneLine,
} from "./hostile-source.js";
import { decode } from "./rust/drivers.js";
import {
  cargo,
  cargoVersion,
  cleanCargo,
  dispose,
  fetchDependencies,
  modelFrom,
  rustOptions,
  writeCheckout,
  type Checkout,
} from "./rust/native.js";

vi.setConfig({ testTimeout: 600_000, hookTimeout: 3_600_000 });
const native = test.skipIf(cargoVersion === undefined);
const prefix = "sourcedata";
const types = ["--manifest-path", "rust/Cargo.toml", "--package", `${prefix}-types`];
let built: Checkout | undefined;

/** Checkout that the suite setup wrote and built
 * @returns Built checkout
 * @throws Error when the setup has not built it
 */
function checkout(): Checkout {
  if (built === undefined) throw new Error("the source-data crates have not been built");
  return built;
}

beforeAll(async () => {
  if (cargoVersion === undefined) return;
  const source = "tests/fixtures/rust/source-data/main.tsp";
  const model = await modelFrom(source, "SourceData", hostileContract("../../../../lib/main.tsp"));
  built = await writeCheckout(
    prefix,
    rustSourceDataFiles(model, rustOptions("SourceData", prefix)),
  );
  fetchDependencies(built, ["rust/Cargo.toml", "rust/fixture-codec/Cargo.toml"]);
  cleanCargo(built, "build", types);
  cleanCargo(built, "build", ["--manifest-path", "rust/fixture-codec/Cargo.toml", "--all-targets"]);
  cleanCargo(built, "doc", [...types, "--no-deps"]);
});
afterAll(async () => {
  await dispose(built);
});

/** Codec observation executable of the built checkout
 * @returns Executable and working directory
 */
function codec(): { readonly codec: string; readonly root: string } {
  const { root, target } = checkout();
  return { codec: join(target, "debug/codec"), root };
}

/** Readable text of every documentation page of the generated types crate
 * @returns Page text with markup removed and whitespace collapsed
 */
function documentation(): string {
  const directory = join(checkout().target, "doc", `${prefix}_types`);
  return readdirSync(directory)
    .filter((page) => page.endsWith(".html"))
    .map((page) => readFileSync(join(directory, page), "utf8"))
    .join(" ")
    .replace(/<[^>]*>/g, "")
    .replace(/[\s\u0085]+/g, " ");
}

native("builds the types crate, the codec crate and the documentation without a warning", () => {
  expect(existsSync(codec().codec)).toBe(true);
  expect(documentation()).not.toBe("");
});

native("keeps every description of a declaration as documentation text", () => {
  const text = documentation();
  for (const [label, kind] of declarations) expect(text, label).toContain(oneLine(label, kind));
  expect(text).toContain(`Payload for exact tag ${pickTagOneLine}`);
});

native("keeps every description of a member as documentation of the constructor parameter", () => {
  const text = documentation();
  for (const label of memberBreaks)
    expect(text, label).toContain(`field_${label}: ${oneLine(label)}`);
  expect(text).toContain("field_fence: fence-before");
  expect(text).toContain("fence-after");
  expect(text).toContain(`field_bare: owned ${wireNameOneLine} presence state`);
});

native("runs no documentation as a test, whatever a description holds", () => {
  const outcome = cargo(checkout(), ["test", "--offline", ...types], false);
  expect(outcome.status, outcome.stdout + outcome.stderr).toBe(0);
  expect(outcome.stdout + outcome.stderr).not.toMatch(/Doc-tests|doctest executed/);
});

native("accepts each closed value as its contract spells it and rejects its lookalikes", () => {
  for (const [name, value] of Object.entries(flavorValues)) {
    const observation = decode(codec(), "Flavor", JSON.stringify(value));
    expect(observation.accepted, name).toBe(true);
    expect(JSON.parse(String(observation.encoded)), name).toBe(value);
  }
  for (const lookalike of lookalikes) {
    const observation = decode(codec(), "Flavor", JSON.stringify(lookalike));
    expect(observation.accepted, lookalike).toBe(false);
    expect(observation.violations, lookalike).toEqual([{ path: "", rule: "literal" }]);
  }
});

native("round-trips an object whose member names and descriptions are hostile", () => {
  const observation = decode(codec(), "Specimen", specimenJson);
  expect(observation.accepted).toBe(true);
  expect(JSON.parse(String(observation.encoded))).toEqual(JSON.parse(specimenJson));
});

native("round-trips the union case selected by a hostile tag", () => {
  for (const json of [pickJson, '{"kind":"plain"}']) {
    const observation = decode(codec(), "Pick", json);
    expect(observation.accepted, json).toBe(true);
    expect(JSON.parse(String(observation.encoded)), json).toEqual(JSON.parse(json));
  }
});
