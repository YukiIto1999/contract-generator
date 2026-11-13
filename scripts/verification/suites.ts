import { readdirSync } from "node:fs";
import { join } from "node:path";

/** Disjoint acceptance collections */
export const suiteNames = [
  "small",
  "profile",
  "arch",
  "local",
  "typescript",
  "csharp",
  "rust",
  "tauri",
] as const;
/** Acceptance collection name */
export type Suite = (typeof suiteNames)[number];
/** Resource size enforced by the collection runner */
export type Size = "small" | "medium";
/** Source test discovery roots */
const roots = ["src", "tests", "scripts"];

/** Runner resource size of an acceptance collection
 * @param suite - Acceptance collection
 * @returns Resource size whose runner executes the collection
 */
export function sizeOf(suite: Suite): Size {
  return suite === "small" ? "small" : "medium";
}

/** Repository files below an input directory
 * @param directory - Checkout-relative input directory
 * @returns Sorted regular file paths
 * @throws {@link Error} Input entry that is neither a regular file nor a directory
 */
export function filesBelow(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return filesBelow(path);
      if (!entry.isFile()) throw new Error(`Input must be a regular file or directory: ${path}`);
      return [path];
    })
    .sort();
}

/** Collection of a root integration test module
 * @param name - File name below `tests/integration/medium/`
 * @returns Owning collection or no root integration collection
 */
function integrationSuite(name: string): Suite | undefined {
  if (name === "tauri-webview.test.ts") return "tauri";
  if (name.startsWith("csharp-")) return "csharp";
  if (name.startsWith("rust-")) return "rust";
  if (name === "typescript-target.test.ts") return "typescript";
  const local =
    /^(publication(?:-[a-z]+)?|safe-pattern-publication|emitter|prepare-native-fixtures|verification-entry|small-worker)\.test\.ts$/;
  return local.test(name) ? "local" : undefined;
}

/** Required collection of a discovered test module
 * @param path - Checkout-relative test path
 * @returns Unique owning collection
 * @throws {@link Error} Test path outside every placement and collection rule
 */
export function suiteOf(path: string): Suite {
  if (path.startsWith("src/profile/tests/medium/")) return "profile";
  const colocated = path.startsWith("src/") || path.startsWith("scripts/");
  if (colocated && !path.includes("/tests/")) return "small";
  if (path.startsWith("tests/arch/medium/") && !path.slice(18).includes("/")) return "arch";
  const prefix = "tests/integration/medium/";
  const name = path.slice(prefix.length);
  const suite = path.startsWith(prefix) && !name.includes("/") ? integrationSuite(name) : undefined;
  if (suite !== undefined) return suite;
  throw new Error(
    `Unclassified test module ${path}; expected colocated Small, src/profile/tests/medium/, tests/arch/medium/ or a named tests/integration/medium/ collection`,
  );
}

/** Exhaustive module inventory without test execution
 * @returns Disjoint nonempty collection inventory
 * @throws {@link Error} Unclassified module or empty required collection
 */
export function suiteInventory(): Record<Suite, string[]> {
  const inventory = Object.fromEntries(suiteNames.map((name) => [name, [] as string[]])) as Record<
    Suite,
    string[]
  >;
  for (const path of roots.flatMap(filesBelow).filter((path) => path.endsWith(".test.ts")))
    inventory[suiteOf(path)].push(path);
  for (const name of suiteNames)
    if (inventory[name].length === 0) throw new Error(`Empty required test collection: ${name}`);
  return inventory;
}

/** Collection named by an untrusted selection
 * @param selection - Environment-provided collection name
 * @returns Known collection
 * @throws {@link Error} Unknown collection name
 */
export function parseSuite(selection: string): Suite {
  const name = suiteNames.find((name) => name === selection);
  if (name === undefined)
    throw new Error(`Unknown test collection: ${selection}; expected ${suiteNames.join(", ")}`);
  return name;
}

/** Selected modules for the native test runner
 * @param selection - Optional single acceptance collection
 * @returns Exact paths selected from exhaustive discovery
 */
export function selectedSuites(selection: string | undefined): string[] {
  const inventory = suiteInventory();
  if (selection === undefined) return suiteNames.flatMap((name) => inventory[name]);
  return inventory[parseSuite(selection)];
}
