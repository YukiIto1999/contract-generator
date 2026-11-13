import { readFileSync, statSync } from "node:fs";
import { createRequire, findPackageJSON, isBuiltin } from "node:module";
import { extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";
import {
  entryResolution,
  resolutionKey,
  type ModuleFormat,
  type ResolutionKind,
  type RunnerSnapshot,
} from "./memory-loader.ts";
import { localModule } from "./source-inputs.ts";

/** Literal runtime dependencies without erased TypeScript imports
 * @param source - Module source
 * @returns Import and require specifiers that can execute
 */
function runtimeImports(source: string): string[] {
  const imports = new Set<string>();
  const file = ts.createSourceFile("module.ts", source, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const erased =
        clause?.isTypeOnly ||
        (clause?.name === undefined &&
          bindings !== undefined &&
          ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 &&
          bindings.elements.every((binding) => binding.isTypeOnly));
      if (!erased && ts.isStringLiteral(node.moduleSpecifier))
        imports.add(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node)) {
      const clause = node.exportClause;
      const erased =
        node.isTypeOnly ||
        (clause !== undefined &&
          ts.isNamedExports(clause) &&
          clause.elements.length > 0 &&
          clause.elements.every((binding) => binding.isTypeOnly));
      if (!erased && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier))
        imports.add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const literal = node.arguments[0];
      if (
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
        literal !== undefined &&
        ts.isStringLiteralLike(literal)
      )
        imports.add(literal.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...imports];
}

/** Native package roots of the selected test graph whose modules Vitest otherwise transforms
 * @param entries - Selected local test source paths
 * @returns Resolved package roots, including CommonJS wrappers with native require calls
 */
function testPackageRoots(entries: readonly string[]): string[] {
  const pending = [...entries];
  const seen = new Set<string>();
  const roots = new Set<string>();
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    if (seen.has(path)) continue;
    seen.add(path);
    if (!/\.[cm]?[jt]s$/.test(path)) continue;
    const parentURL = pathToFileURL(path).href;
    for (const specifier of runtimeImports(readFileSync(path, "utf8"))) {
      if (isBuiltin(specifier) || specifier.startsWith("data:")) continue;
      const local = localModule(path, specifier);
      if (local !== undefined) {
        pending.push(local);
        continue;
      }
      for (const kind of ["import", "require"] as const) {
        const root = resolveWithNode(specifier, parentURL, kind);
        if (root !== undefined) roots.add(root);
      }
    }
  }
  return [...roots];
}

/** Module format Node assigns to a runner file
 * @param url - Resolved file URL
 * @returns Format served by the loader
 * @throws {@link Error} Native addon or other file that a Small worker cannot load from memory
 */
function formatOf(url: string): ModuleFormat {
  const extension = extname(fileURLToPath(url));
  if (extension === ".mjs") return "module";
  if (extension === ".cjs") return "commonjs";
  if (extension === ".json") return "json";
  if (extension !== ".js")
    throw new Error(`Unsupported Small worker module ${url}; expected .js, .mjs, .cjs or .json`);
  const manifest = findPackageJSON(url);
  const fields: unknown =
    manifest === undefined ? undefined : JSON.parse(readFileSync(manifest, "utf8"));
  const type =
    typeof fields === "object" && fields !== null && "type" in fields ? fields.type : undefined;
  return type === "module" ? "module" : "commonjs";
}

/** Node's resolution of one literal specifier for one resolution kind
 * @param specifier - Literal module specifier
 * @param parentURL - Importing module
 * @param kind - Import or require resolution
 * @returns Existing resolved file URL or no resolution
 */
function resolveWithNode(
  specifier: string,
  parentURL: string,
  kind: ResolutionKind,
): string | undefined {
  try {
    const url =
      kind === "require"
        ? pathToFileURL(createRequire(parentURL).resolve(specifier)).href
        : import.meta.resolve(specifier, parentURL);
    return url.startsWith("file:") && statSync(fileURLToPath(url)).isFile() ? url : undefined;
  } catch {
    return undefined;
  }
}

/** CommonJS source using Node's hook-aware require without moving directive prologues
 * @param source - Original CommonJS source
 * @returns Source whose native require resolves exclusively through the registered snapshot hooks
 */
function hookAwareCommonJS(source: string): string {
  const file = ts.createSourceFile(
    "module.cjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const first = file.statements.find(
    (statement) =>
      !ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression),
  );
  const position = first?.getStart(file) ?? source.length;
  // Node 24's imported-CJS require resolves filenames outside hooks before loading provided source
  const bootstrap = '\n;require = require("node:module").createRequire(__filename);\n';
  return source.slice(0, position) + bootstrap + source.slice(position);
}

/** Static module closure of the Small worker runtime with Node's own resolutions
 * @param entry - Absolute path of the runner worker entry
 * @param externalized - Runner packages that Vitest imports natively for test modules
 * @param sources - Selected local test source roots whose package dependencies may retain native require calls
 * @returns Sources, formats and resolutions fixed before any test runs
 * @throws {@link Error} Externalized runner package that Node cannot resolve from the entry
 */
export function runnerSnapshot(
  entry: string,
  externalized: readonly string[],
  sources: readonly string[],
): RunnerSnapshot {
  const entryURL = pathToFileURL(entry).href;
  const modules: Record<string, RunnerSnapshot["modules"][string]> = {};
  const resolutions: Record<string, string> = entryResolution(entryURL);
  const pending = [entryURL, ...testPackageRoots(sources)];
  for (const specifier of externalized) {
    const root = resolveWithNode(specifier, entryURL, "import");
    if (root === undefined)
      throw new Error(`Externalized runner package ${specifier} is not resolvable from ${entry}`);
    pending.push(root);
  }
  for (let url = pending.pop(); url !== undefined; url = pending.pop()) {
    if (Object.hasOwn(modules, url)) continue;
    const source = readFileSync(fileURLToPath(url), "utf8");
    const format = formatOf(url);
    modules[url] = { format, source: format === "commonjs" ? hookAwareCommonJS(source) : source };
    for (const specifier of runtimeImports(source)) {
      if (isBuiltin(specifier) || specifier.startsWith("data:")) continue;
      for (const kind of ["import", "require"] as const) {
        const target = resolveWithNode(specifier, url, kind);
        if (target === undefined) continue;
        resolutions[resolutionKey(url, kind, specifier)] = target;
        pending.push(target);
      }
    }
  }
  return { modules, resolutions };
}

const [entry, ...arguments_] = process.argv.slice(2);
if (entry === undefined) throw new Error("Expected the absolute Small worker entry path");
const separator = arguments_.indexOf("--sources");
const externalized = separator === -1 ? arguments_ : arguments_.slice(0, separator);
const sources = separator === -1 ? [] : arguments_.slice(separator + 1);
process.stdout.write(JSON.stringify(runnerSnapshot(entry, externalized, sources)));
