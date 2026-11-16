import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import {
  adversarialCases,
  semanticCases,
  type SemanticCase,
} from "../../../src/model/patterns/semantic-vectors.fixture.js";
import { renderRust } from "../../../src/targets/rust/render-rust.js";
import { rustCodecFiles } from "../../fixtures/rust/materialize.js";
import { decode } from "./rust/drivers.js";
import {
  cleanCargo,
  dispose,
  fetchDependencies,
  modelFrom,
  rustOptions,
  writeCheckout,
  type Checkout,
} from "./rust/native.js";

vi.setConfig({ testTimeout: 600_000, hookTimeout: 3_600_000 });
const native = test;
const prefix = "patterns";
const source = "tests/fixtures/rust/patterns/main.tsp";
const options = rustOptions("Patterns", prefix);

/** The shared membership vector, whose adversarial witnesses are one member and one non-member each */
const cases: readonly SemanticCase[] = [
  ...semanticCases,
  ...adversarialCases.map(({ pattern, yes, no }) => ({ pattern, yes: [yes], no: [no] })),
];

/** TypeSpec string literal of a text, which only has to keep backslashes, quotes and the interpolation marker
 * @param text - String value
 * @returns Literal whose value is the text
 */
function literal(text: string): string {
  return JSON.stringify(text).replaceAll("$", "\\$");
}

/** Contract source of text scalars
 * @param patterns - Pattern of each scalar, named `Pattern<index>` by its position in the vector
 * @returns TypeSpec source in the namespace `Patterns`
 */
function contract(patterns: ReadonlyMap<number, string>): string {
  return [
    'import "../../../../lib/main.tsp";',
    "using ContractGenerator;",
    "namespace Patterns;",
    ...[...patterns].map(
      ([index, pattern]) => `@pattern(${literal(pattern)}) scalar Pattern${index} extends string;`,
    ),
  ].join("\n");
}

/** Whether the Rust generator accepts one pattern
 * @param index - Position of the case in the vector
 * @returns Issue reasons that refuse the pattern, or none when Rust generates it
 */
async function refusal(index: number): Promise<readonly string[]> {
  const model = await modelFrom(
    source,
    "Patterns",
    contract(new Map([[index, cases[index]!.pattern]])),
  );
  const rendered = renderRust(model, options);
  return rendered.isErr() ? rendered.error.map((issue) => issue.reason) : [];
}

/** Positions of the vector that Rust generates, and the reasons for the others */
const refused = new Map<number, readonly string[]>();
let built: Checkout | undefined;

/** Built checkout
 * @returns Checkout that the suite setup built
 * @throws Error when the setup has not built it
 */
function checkout(): Checkout {
  if (built === undefined) throw new Error("the pattern crates have not been built");
  return built;
}

/** Source of the codec observations of the generated scalars
 * @param supported - Positions of the scalars that Rust generated
 * @returns Rust source with one arm per scalar
 */
function codecSource(supported: readonly number[]): string {
  return `//! Public codec observations of the pattern scalars, spelled with the literal generated names
use serde_json::{Value, json};
use types::Binding;

/// Decode through the public codec, then encode the accepted value
macro_rules! observation {
    ($decode:path, $encode:path, $source:expr, $binding:expr) => {
        match $decode($source, $binding) {
            Ok(accepted) => json!({"accepted": true, "encoded": $encode(&accepted.value, $binding), "diagnostics": accepted.diagnostics, "violations": []}),
            Err(failure) => json!({"accepted": false, "diagnostics": failure.diagnostics, "violations": failure.violations}),
        }
    };
}

/// One public generated-codec observation
pub fn observe(name: &str, source: &str, binding: Binding) -> Value {
    match name {
${supported.map((index) => `        "Pattern${index}" => observation!(types::decode_pattern${index}, types::encode_pattern${index}, source, binding),`).join("\n")}
        _ => panic!("unknown fixture type"),
    }
}
`;
}

beforeAll(async () => {
  for (const index of cases.keys()) {
    const reasons = await refusal(index);
    if (reasons.length > 0) refused.set(index, reasons);
  }
  const supported = [...cases.keys()].filter((index) => !refused.has(index));
  const model = await modelFrom(
    source,
    "Patterns",
    contract(new Map(supported.map((index) => [index, cases[index]!.pattern]))),
  );
  built = await writeCheckout(prefix, rustCodecFiles(model, options, codecSource(supported)));
  fetchDependencies(built, ["rust/Cargo.toml", "rust/fixture-codec/Cargo.toml"]);
  cleanCargo(built, "build", [
    "--manifest-path",
    "rust/Cargo.toml",
    "--package",
    `${prefix}-types`,
  ]);
  cleanCargo(built, "build", ["--manifest-path", "rust/fixture-codec/Cargo.toml", "--all-targets"]);
});
afterAll(async () => {
  await dispose(built);
});

for (const [index, entry] of cases.entries())
  native(
    `keeps the membership of ${JSON.stringify(entry.pattern)}, or refuses to generate it`,
    () => {
      const reasons = refused.get(index);
      if (reasons !== undefined) {
        expect(reasons.join("\n"), JSON.stringify(entry.pattern)).toContain("Rust");
        return;
      }
      const { root, target } = checkout();
      const driver = { codec: `${target}/debug/codec`, root };
      for (const value of entry.yes) {
        const observation = decode(driver, `Pattern${index}`, JSON.stringify(value));
        expect(observation.accepted, JSON.stringify(value.slice(0, 40))).toBe(true);
        expect(JSON.parse(String(observation.encoded))).toBe(value);
      }
      for (const value of entry.no) {
        const observation = decode(driver, `Pattern${index}`, JSON.stringify(value));
        expect(observation.accepted, JSON.stringify(value.slice(0, 40))).toBe(false);
        expect(observation.violations).toEqual([{ path: "", rule: "format" }]);
      }
    },
  );
