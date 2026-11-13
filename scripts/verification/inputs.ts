import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { auditReceiptFile } from "../native-fixtures/package-audit.ts";
import { csharpDependencyRoots } from "./environment.ts";
import { sourceClosure } from "./source-inputs.ts";
import { filesBelow, suiteInventory, type Suite } from "./suites.ts";

/** Static checks sharing the tiered acceptance entry */
export type Check = "build" | "typecheck" | "check" | Suite;
/** Tool metadata excluded from installed dependency identity */
const outputs: Readonly<Record<string, true>> = {
  ".git": true,
  ".cache": true,
  ".vite": true,
  ".vite-temp": true,
  ".bin": true,
};
/** Generated artifacts excluded only inside copied C# source trees */
const buildOutputs: Readonly<Record<string, true>> = {
  bin: true,
  obj: true,
  target: true,
  work: true,
  ".devenv": true,
  ".direnv": true,
};

/** Source files of an installed dependency tree
 * @param directory - Dependency checkout or installed package directory
 * @param copiedSource - Exclusion of generated C# source-tree build artifacts
 * @returns Sorted current dependency inputs
 */
export function dependencyFiles(directory: string, copiedSource = false): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      if (outputs[entry.name] || (copiedSource && buildOutputs[entry.name])) return [];
      if (entry.name === ".vitest-cache" && basename(directory) === "node_modules") return [];
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return dependencyFiles(path, copiedSource);
      if (entry.isSymbolicLink()) {
        const target = realpathSync(path);
        return statSync(target).isDirectory() ? dependencyFiles(target, copiedSource) : [target];
      }
      if (!entry.isFile()) throw new Error(`Unresolved dependency input type: ${path}`);
      return [path];
    })
    .sort();
}

/** Directory entries below a cache root
 * @param root - Existing cache directory
 * @returns Names of child directories
 */
function directories(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/** Version-addressed native package caches consulted by offline acceptance
 * @param check - Native acceptance collection
 * @param env - Actual tool-home configuration
 * @returns Sorted package versions with the NuGet content hash where available
 */
export function nativePackageIdentity(check: Check, env: NodeJS.ProcessEnv): string[] {
  const home = env.HOME ?? "";
  if (check === "csharp") {
    const root = env.NUGET_PACKAGES ?? join(home, ".nuget/packages");
    if (!existsSync(root)) return [];
    return directories(root)
      .flatMap((id) =>
        directories(join(root, id)).map((version) => {
          const hash = join(root, id, version, `${id}.${version}.nupkg.sha512`);
          return `${id}/${version}:${existsSync(hash) ? readFileSync(hash, "utf8").trim() : "incomplete"}`;
        }),
      )
      .sort();
  }
  if (check !== "rust" && check !== "tauri") return [];
  const cargo = env.CARGO_HOME ?? join(home, ".cargo");
  return [join(cargo, "registry/cache"), join(cargo, "git/checkouts")]
    .filter(existsSync)
    .flatMap((root) =>
      directories(root).flatMap((source) =>
        readdirSync(join(root, source)).map((entry) => relative(cargo, join(root, source, entry))),
      ),
    )
    .sort();
}

/** Actual working-copy inputs for formatter and lint discovery
 * @returns Tracked and untracked nonignored existing paths
 */
function workingFiles(): string[] {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`Cannot determine check inputs: ${result.stderr}`);
  return result.stdout
    .split("\0")
    .filter((path) => path !== "" && existsSync(path))
    .sort();
}

/** File-content digest including path identity
 * @param paths - Exact input paths
 * @returns SHA256 of the current bytes and path set
 */
export function digestFiles(paths: readonly string[]): string {
  const hash = createHash("sha256");
  for (const path of [...new Set(paths)].sort()) {
    hash.update(JSON.stringify(relative(process.cwd(), resolve(path))));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/** Fixture trees read or materialized at runtime by native acceptance collections */
const runtimeFixtures: Readonly<Partial<Record<Suite, readonly string[]>>> = {
  local: ["tests/fixtures/contracts"],
  typescript: ["tests/fixtures/contracts", "tests/fixtures/typescript"],
  csharp: ["tests/fixtures/contracts", "tests/fixtures/csharp"],
  rust: ["tests/fixtures/contracts", "tests/fixtures/rust"],
  tauri: ["tests/fixtures/rust", "tests/fixtures/tauri", "tests/fixtures/typescript"],
};

/** Inputs that a test collection reaches outside its static import closure
 * @param suite - Test collection
 * @param env - Explicit native environment
 * @returns Spawned helpers, fixtures, built emitter and native dependency inputs
 */
function runtimeInputs(suite: Suite, env: NodeJS.ProcessEnv): string[] {
  if (suite === "small" || suite === "profile") return [];
  if (suite === "arch") return filesBelow("src");
  const paths = filesBelow("tests/integration/medium").filter((path) => !path.endsWith(".test.ts"));
  paths.push("lib/main.tsp", ...(runtimeFixtures[suite] ?? []).flatMap(filesBelow));
  if (suite === "local" || suite === "tauri")
    paths.push(
      ...sourceClosure(["src/index.ts"]),
      ...(existsSync("dist") ? dependencyFiles("dist") : []),
    );
  if (suite === "local")
    paths.push("scripts/prepare-native-fixtures.ts", ...filesBelow("scripts/native-fixtures"));
  if (suite === "csharp") {
    paths.push(...csharpDependencyRoots(env).flatMap((root) => dependencyFiles(root, true)));
    if (existsSync(auditReceiptFile)) paths.push(auditReceiptFile);
  }
  if (suite === "rust" || suite === "tauri") paths.push("devenv.nix", "devenv.yaml", "devenv.lock");
  return paths;
}

/** Current source dependency closure for one acceptance check
 * @param check - Selected static check or test collection
 * @param env - Explicit native environment
 * @returns Required source and dynamic fixture input paths
 */
export function checkInputs(check: Check, env: NodeJS.ProcessEnv): string[] {
  const verifier = filesBelow("scripts/verification").filter((path) => !path.endsWith(".test.ts"));
  const common = [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vite.config.ts",
    ...verifier,
  ];
  if (check === "check") return [...common, ...workingFiles()];
  if (check === "typecheck") return [...common, ...["src", "tests", "scripts"].flatMap(filesBelow)];
  if (check === "build") return [...common, ...sourceClosure(["src/index.ts"])];
  const paths = [
    ...common,
    ...sourceClosure(suiteInventory()[check]),
    ...runtimeInputs(check, env),
  ];
  return [...new Set(paths)].sort();
}

/** Hash of structured command or environment identity
 * @param value - Deterministic serializable identity
 * @returns SHA256 of the identity
 */
export function digestValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
