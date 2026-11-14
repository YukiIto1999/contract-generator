import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { rustDependencies, rustMinimumVersion } from "../../../src/targets/rust/dependencies.ts";
import { run, type Execution } from "./process.ts";

/** Locations and environment of one temporary fixture checkout */
export interface Checkout {
  /** Repository owning the built emitter and installed JavaScript dependencies */
  readonly repository: string;
  /** Literal fixture inputs */
  readonly fixture: string;
  /** Tracked complete Cargo resolution of the fixture host */
  readonly lock: string;
  /** Generation inside the owned temporary checkout */
  readonly execution: Execution;
}

/** Materialized fixture file with ownership confined to the temporary checkout
 * @param checkout - Owned temporary checkout
 * @param path - Relative output path
 * @param content - Complete file bytes
 * @returns Completion after writing the owned file
 */
async function file(checkout: Checkout, path: string, content: string | Uint8Array): Promise<void> {
  const destination = join(checkout.execution.cwd, path);
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

/** PNG chunk for the required fixture application icon
 * @param name - PNG chunk identifier
 * @param data - Complete chunk data
 * @returns Length-prefixed chunk with its standard CRC
 */
function pngChunk(name: string, data: Uint8Array): Buffer {
  const body = Buffer.concat([Buffer.from(name), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

/** Latest stable 2.x releases of the Tauri shell and its Wry webview runtime at fixture adoption; compatible with the pinned 1.94.0 compiler (tauri 2.12.5 declares 1.90) */
export const pins = {
  tauri: "2.12.5",
  tauriRuntimeWry: "2.12.3",
  tauriBuild: "2.7.4",
  wry: "0.57.2",
} as const;

/** Crates that the host resolution must contain exactly once, spelled as `cargo tree` prints them */
export const pinnedCrates = [
  `tauri v${pins.tauri}`,
  `tauri-build v${pins.tauriBuild}`,
  `tauri-runtime-wry v${pins.tauriRuntimeWry}`,
  `wry v${pins.wry}`,
];

/** Exact direct dependencies of the real Wry composition root
 * @returns Cargo manifest linked to the emitted Rust crates
 */
function manifest(): string {
  const d = rustDependencies;
  return [
    "[package]",
    'name = "contract-tauri-acceptance"',
    'version = "0.0.0"',
    'edition = "2024"',
    `rust-version = "${rustMinimumVersion}"`,
    "publish = false",
    "",
    "[workspace]",
    "",
    "[dependencies]",
    'types = { package = "desktop-probe-types", path = "../generated/rust/types" }',
    'transport = { package = "desktop-probe-transport", path = "../generated/rust/transport" }',
    'provider = { package = "desktop-probe-provider", path = "../generated/rust/provider" }',
    `serde_json = { version = "=${d.serde_json}", features = ["arbitrary_precision"] }`,
    `tokio = { version = "=${d.tokio}", features = ["sync"] }`,
    `tauri = { version = "=${pins.tauri}", default-features = false, features = ["wry", "custom-protocol", "x11"] }`,
    `tauri-runtime-wry = { version = "=${pins.tauriRuntimeWry}", default-features = false, features = ["x11"] }`,
    `wry = { version = "=${pins.wry}", default-features = false, features = ["os-webview", "linux-body", "x11"] }`,
    "",
    "[build-dependencies]",
    `tauri-build = "=${pins.tauriBuild}"`,
    "",
  ].join("\n");
}

/** Compiler configuration of the generated consumer and the webview source
 * @returns Strict TypeScript project over the materialized frontend
 */
function viewerProject(): string {
  return JSON.stringify({
    compilerOptions: {
      target: "ESNext",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      exactOptionalPropertyTypes: true,
      noUncheckedIndexedAccess: true,
      verbatimModuleSyntax: true,
      skipLibCheck: true,
      types: [],
      lib: ["ESNext", "DOM"],
      noEmit: true,
    },
    include: ["frontend/*.ts", "generated/typescript/*.ts"],
  });
}

/** Actual TypeSpec emitter invocation into the temporary checkout
 * @param checkout - Owned temporary checkout
 * @returns Completion after generation
 * @throws {@link Error} Missing emitter build or failed generation
 */
async function generate(checkout: Checkout): Promise<void> {
  const { repository } = checkout;
  assert.ok(
    existsSync(join(repository, "dist/index.js")),
    "Build the emitter with npm run build before running this fixture",
  );
  const source = await readFile(join(checkout.fixture, "main.tsp"), "utf8");
  const library = JSON.stringify(join(repository, "lib/main.tsp"));
  await file(checkout, "main.tsp", source.replace('"../../../lib/main.tsp"', library));
  const options = [
    "emit:",
    `  - ${JSON.stringify(repository)}`,
    "options:",
    '  "@yukiito1999/contract-generator":',
    '    emitter-output-dir: "{project-root}/generated"',
    "    namespace: DesktopProbe",
    "    targets: [typescript, rust]",
    "    rust-crate-prefix: desktop-probe",
    '    typescript-effect-module: "./effect.js"',
    "",
  ];
  await file(checkout, "tspconfig.yaml", options.join("\n"));
  await symlink(
    join(repository, "node_modules"),
    join(checkout.execution.cwd, "node_modules"),
    "dir",
  );
  await file(checkout, "package.json", '{"private":true,"type":"module"}\n');
  const compiler = join(repository, "node_modules/@typespec/compiler/cmd/tsp.js");
  await run(process.execPath, [compiler, "compile", "main.tsp"], checkout.execution);
}

/** Generated products plus literal host and viewer sources in the temporary checkout
 * @param checkout - Owned temporary checkout
 * @returns Completion after fixture assembly
 * @throws {@link Error} Missing emitter build or failed generation
 */
export async function materialize(checkout: Checkout): Promise<void> {
  await generate(checkout);
  const typesRoot = await readFile(
    join(checkout.execution.cwd, "generated/rust/types/src/lib.rs"),
    "utf8",
  );
  const recursionLimit = typesRoot.match(/^#!\[recursion_limit = "\d+"\]/u)?.[0];
  assert.ok(recursionLimit, "Generated types crate must declare its model-derived recursion limit");
  const host = await readFile(join(checkout.fixture, "host.rs"), "utf8");
  await file(checkout, "host/src/main.rs", `${recursionLimit}\n${host}`);
  await file(checkout, "host/Cargo.toml", manifest());
  await file(checkout, "host/build.rs", "fn main() { tauri_build::build() }\n");
  const sources = [
    ["tauri.conf.json", "host/tauri.conf.json"],
    ["viewer.ts", "frontend/viewer.ts"],
    ["index.html", "frontend/index.html"],
  ] as const;
  for (const [name, destination] of sources)
    await file(checkout, destination, await readFile(join(checkout.fixture, name), "utf8"));
  const root = checkout.execution.cwd;
  await copyFile(
    join(checkout.fixture, "../typescript/effect.ts"),
    join(root, "generated/typescript/effect.ts"),
  );
  const header = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0]);
  const pixel = deflateSync(Buffer.from([0, 24, 97, 67, 255]));
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = [
    pngChunk("IHDR", header),
    pngChunk("IDAT", pixel),
    pngChunk("IEND", Buffer.alloc(0)),
  ];
  await file(checkout, "host/icons/icon.png", Buffer.concat([signature, ...chunks]));
  await file(checkout, "tsconfig.json", viewerProject());
  if (existsSync(checkout.lock)) await copyFile(checkout.lock, join(root, "host/Cargo.lock"));
}
