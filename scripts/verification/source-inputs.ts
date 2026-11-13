import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import ts from "typescript";

/** Parsed static module reference */
export interface ModuleReference {
  /** Literal specifier as written in the importing module */
  readonly specifier: string;
  /** Checkout-relative local module, or absent for a package or builtin */
  readonly target: string | undefined;
}

/** Local module resolution preserving raw fixture dependencies
 * @param owner - Importing checkout-relative module
 * @param specifier - Literal module specifier
 * @returns Resolved local input or external dependency
 * @throws {@link Error} Relative or absolute specifier without an existing module file
 */
export function localModule(owner: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".") && !isAbsolute(specifier)) return undefined;
  const path = resolve(dirname(owner), specifier.replace(/\?raw$/, ""));
  const candidates = [path, path.replace(/\.js$/, ".ts"), `${path}.ts`];
  const found = candidates.find(existsSync);
  if (found === undefined) throw new Error(`Unresolved module input: ${owner} -> ${specifier}`);
  return relative(process.cwd(), found);
}

/** Literal imports discovered by the TypeScript parser
 * @param owner - Checkout-relative source input
 * @returns Module dependencies including type-only references
 */
export function moduleReferences(owner: string): ModuleReference[] {
  const source = readFileSync(owner, "utf8");
  const references = ts.preProcessFile(source, true, true).importedFiles;
  return references.map(({ fileName }) => ({
    specifier: fileName,
    target: localModule(owner, fileName),
  }));
}

/** Transitive source closure with unresolved local inputs rejected
 * @param entries - Source and fixture entry paths
 * @returns Sorted complete static local input closure
 */
export function sourceClosure(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const pending = [...entries];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (seen.has(path)) continue;
    seen.add(path);
    if (!/\.[cm]?[jt]s$/.test(path)) continue;
    for (const reference of moduleReferences(path))
      if (reference.target !== undefined) pending.push(reference.target);
  }
  return [...seen].sort();
}
