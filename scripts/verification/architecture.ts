import { readFileSync } from "node:fs";
import ts from "typescript";
import { moduleReferences, sourceClosure, type ModuleReference } from "./source-inputs.ts";

/** Private generator seam determined by source ownership
 * @param path - Checkout-relative production source
 * @returns Owning seam
 */
function seam(path: string): string {
  const segments = path.split("/");
  if (segments.length === 2) return "src";
  return segments.slice(0, segments[1] === "targets" ? 3 : 2).join("/");
}

/** Production generator source rather than colocated or adapter-near test support
 * @param path - Checkout-relative resolved module
 * @returns Whether the module ships in the emitter source closure
 */
function productionSource(path: string): boolean {
  return (
    path.startsWith("src/") && !path.includes("/tests/") && !/\.(test|fixture)\.ts$/.test(path)
  );
}

/** Import violation against the generator's current public/private contract
 * @param owner - Checkout-relative production source
 * @param reference - Resolved static source reference
 * @returns Actionable violation or no violation
 */
export function importViolation(owner: string, reference: ModuleReference): string | undefined {
  const { specifier, target } = reference;
  const ownerSeam = seam(owner);
  const allowed = [
    ownerSeam,
    "src/model",
    ...(ownerSeam === "src/profile" ? ["src/emitter-options.ts"] : []),
  ];
  if (target !== undefined) {
    const permitted =
      ownerSeam === "src" || allowed.includes(seam(target)) || allowed.includes(target);
    if (productionSource(target) && permitted) return undefined;
    const route = ownerSeam === "src" ? " through root composition" : "";
    return `generator-seams: ${owner} imports ${specifier} -> ${target}; expected ${allowed.join(" or ")} production source${route}`;
  }
  if (specifier.startsWith("node:")) return undefined;
  if (specifier === "ts-results-es" || specifier === "lossless-json") return undefined;
  if (
    owner.startsWith("src/model/patterns/") &&
    ["@eslint-community/regexpp", "re2js"].includes(specifier)
  )
    return undefined;
  if (specifier.startsWith("@typespec/compiler") && ["src", "src/profile"].includes(ownerSeam))
    return undefined;
  return `generator-dependencies: ${owner} imports ${specifier}; expected declared runtime dependencies or compiler access in profile/root composition only`;
}

/** Public emitter symbol names from the TypeScript module checker
 * @returns Sorted public symbol names
 */
function publicSymbols(): string[] {
  const program = ts.createProgram(["src/index.ts"], { module: ts.ModuleKind.NodeNext });
  const source = program.getSourceFile("src/index.ts");
  const checker = program.getTypeChecker();
  const symbol = source === undefined ? undefined : checker.getSymbolAtLocation(source);
  if (symbol === undefined) throw new Error("Missing public emitter module: src/index.ts");
  return checker
    .getExportsOfModule(symbol)
    .map((symbol) => symbol.name)
    .sort();
}

/** Violations of package export isolation and normalized generator seams
 * @returns Every violation against the current module contract
 */
export function architectureViolations(): string[] {
  const failures: string[] = [];
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as { exports: unknown };
  const expected = { ".": "./dist/index.js", "./package.json": "./package.json" };
  if (JSON.stringify(manifest.exports) !== JSON.stringify(expected))
    failures.push(
      `private-package-exports: package.json exports ${JSON.stringify(manifest.exports)}; expected ${JSON.stringify(expected)}`,
    );
  const symbols = publicSymbols();
  const expectedSymbols = ["$decorators", "$lib", "$onEmit"];
  if (JSON.stringify(symbols) !== JSON.stringify(expectedSymbols))
    failures.push(
      `private-emitter-api: src/index.ts exports ${JSON.stringify(symbols)}; expected ${JSON.stringify(expectedSymbols)}`,
    );
  for (const owner of sourceClosure(["src/index.ts"])) {
    for (const reference of moduleReferences(owner)) {
      const failure = importViolation(owner, reference);
      if (failure !== undefined) failures.push(failure);
    }
  }
  return failures;
}
