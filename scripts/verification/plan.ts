import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { dependencyFiles, digestFiles, type Check } from "./inputs.ts";
import { sandboxPrefix } from "./sandbox.ts";
import { sizeOf, suiteNames, type Suite } from "./suites.ts";

/** Fast commit acceptance checks */
export const commitChecks: readonly Check[] = [
  "build",
  "typecheck",
  "check",
  "small",
  "profile",
  "arch",
  "local",
];
/** Native acceptance collections without duplicate commit checks */
export const nativeChecks: readonly Suite[] = ["typescript", "csharp", "rust", "tauri"];
/** MSBuild files that an ancestor directory can contribute to a copied project; NuGet configuration is not one, because the restore reads only the repository's offline configuration */
const inheritedNativeFiles = ["Directory.Build.props", "Directory.Build.targets", "global.json"];

/** Native collection corresponding to a test check
 * @param check - Required check
 * @returns Test collection or no collection for a static check
 */
export function testSuite(check: Check): Suite | undefined {
  return suiteNames.find((suite) => suite === check);
}

/** Literal executable arguments for an acceptance check
 * @param check - Required check
 * @param env - Explicit check environment
 * @returns Size runner wrapper and runner arguments
 */
export function checkCommand(check: Check, env: NodeJS.ProcessEnv): string[] {
  if (check === "typecheck")
    return [process.execPath, "node_modules/typescript-native/bin/tsc", "--noEmit"];
  const runner = [process.execPath, "node_modules/vite-plus/bin/vp"];
  if (check === "build" || check === "check") return [...runner, check];
  return [...sandboxPrefix(sizeOf(check), env), ...runner, "test", "run"];
}

/** Current emitted build outputs for build-evidence reuse
 * @param check - Required check
 * @returns Dist fingerprint or no persistent outputs
 */
export function outputIdentity(check: Check): string | null {
  if (check !== "build") return null;
  if (!existsSync("dist/index.js")) return "missing";
  return digestFiles(dependencyFiles("dist"));
}

/** Existence test of a configuration path, replaceable where no real filesystem is readable */
type Present = (path: string) => boolean;

/** User-owned Cargo configuration whose contents may hold credentials
 * @param env - Actual native execution environment
 * @param present - Existence test of a configuration path
 * @returns Present configuration paths that are not fingerprinted
 */
function cargoConfigurations(env: NodeJS.ProcessEnv, present: Present): string[] {
  const cargo = env.CARGO_HOME ?? join(env.HOME ?? "", ".cargo");
  return [join(cargo, "config.toml"), join(cargo, "config")].filter((path) => present(path));
}

/** Ancestor MSBuild configuration outside the copied dependency sources
 * @param env - Actual native execution environment
 * @param present - Existence test of a configuration path
 * @returns Present inherited configuration paths
 */
function inheritedConfigurations(env: NodeJS.ProcessEnv, present: Present): string[] {
  const found: string[] = [];
  for (const name of ["TypeModelingProjectPath", "EffectSystemProjectPath"]) {
    const project = env[name];
    if (project === undefined) continue;
    for (let path = dirname(project); path !== dirname(path); path = dirname(path))
      if (!path.includes("/work/native-dependencies"))
        found.push(
          ...inheritedNativeFiles.map((file) => join(path, file)).filter((file) => present(file)),
        );
  }
  return found;
}

/** Conservative reason to execute instead of reuse
 * @param check - Required check
 * @param env - Actual native execution environment
 * @param present - Existence test of a configuration path
 * @returns Reuse blocker or permission to compare receipts
 */
export function reuseBlocker(
  check: Check,
  env: NodeJS.ProcessEnv,
  present: Present = existsSync,
): string | undefined {
  if (check === "tauri") return "live display and D-Bus state require a fresh acceptance scenario";
  if (check !== "csharp" && check !== "rust") return undefined;
  const unresolved =
    check === "rust" ? cargoConfigurations(env, present) : inheritedConfigurations(env, present);
  return unresolved.length === 0
    ? undefined
    : `unresolved native tool configuration: ${unresolved.join(", ")}`;
}
