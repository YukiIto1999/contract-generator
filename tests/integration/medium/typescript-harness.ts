import { createTester, mockFile } from "@typespec/compiler/testing";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { promisify } from "node:util";
import type {
  ContractModel,
  EmissionOptions,
  GeneratedFile,
} from "../../../src/model/contract-model.js";
import { compileContract } from "../../../src/profile/compile-contract.js";
import { $decorators, $lib } from "../../../src/profile/library.js";
import { renderTypeScript } from "../../../src/targets/typescript/render-typescript.js";
import { typescriptFixtureFiles } from "../../fixtures/typescript/materialize.js";
import { hostileContract } from "./hostile-source.js";

const run = promisify(execFile);

/** Actual installed compiler rather than a generated-code parser substitute */
const compiler = resolve("node_modules/typescript-native/bin/tsc");

/** Consumer-owned adopted Effect integration */
export const options: EmissionOptions = {
  targets: ["typescript"],
  typescriptEffectModule: "./effect.js",
  csharpNamespace: "Sample",
  rustCratePrefix: "sample",
};

/** Checkout root against which fixture sources and generated consumers are addressed */
const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** One result line of a consumer program */
export interface CheckLine {
  readonly check: string;
  readonly passed: boolean;
  readonly detail?: string;
}

/** Generated project directories created by this file and removed by {@link cleanup} */
const roots: string[] = [];

/**
 * Complete TypeSpec interpretation through the real frontend and the current profile implementation
 * @param source - Checkout-relative TypeSpec source path, which also resolves the imports of an inline source text
 * @param namespace - Selected public contract
 * @param text - Contract source text; the checkout file is read when omitted
 * @returns Normalized model
 */
export async function modelFrom(
  source: string,
  namespace: string,
  text?: string,
): Promise<ContractModel> {
  const declarations = await readFile(new URL("../../../lib/main.tsp", import.meta.url), "utf8");
  const contract = text ?? (await readFile(new URL(`../../../${source}`, import.meta.url), "utf8"));
  const tester = createTester(projectRoot, { libraries: [] })
    .files({
      "lib/main.tsp": declarations,
      "dist/index.js": mockFile.js({ $lib, $decorators }),
      [source]: contract,
    })
    .import(`./${source}`);
  const [compiled] = await tester.compileAndDiagnose("", { compilerOptions: { noEmit: true } });
  const result = compileContract(compiled.program, namespace);
  if (result.isErr()) throw new Error(JSON.stringify(result.error));
  return result.value;
}

/**
 * Owned fixture output materialization
 * @param root - Test-owned temporary checkout-local directory
 * @param files - Complete generated and consumer assets
 * @returns Materialization completion
 */
async function materialize(root: string, files: readonly GeneratedFile[]): Promise<void> {
  for (const file of files) {
    const path = join(root, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
}

/**
 * Real TypeScript compiler invocation on consumer sources
 * @param root - Test-owned fixture root
 * @param config - Generated fixture compiler configuration
 * @returns Compiler completion
 * @throws {@link Error} Consumer sources that do not type-check
 */
export async function typecheck(root: string, config: string): Promise<void> {
  try {
    await run(process.execPath, [compiler, "--project", join(root, "typescript", config)], {
      timeout: 120_000,
    });
  } catch (error) {
    const failure = error as { readonly stdout?: string; readonly stderr?: string };
    throw new Error(
      `TypeScript consumer check failed:\n${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    );
  }
}

/**
 * Generated shared-contract project that type-checked
 * @returns Project root directory
 */
export async function contractProject(): Promise<string> {
  const root = await mkdtemp(resolve(".typescript-contract-"));
  roots.push(root);
  const model = await modelFrom("tests/fixtures/contracts/main.tsp", "Sample");
  await materialize(root, await typescriptFixtureFiles(model, options));
  await typecheck(root, "tsconfig.json");
  return root;
}

/**
 * Standalone generated project with its consumer program, type-checked by the real compiler
 * @param prefix - Directory name stem below the checkout root
 * @param files - Generated files that the project holds
 * @param consumers - Fixture files copied beside them
 * @returns Project root directory
 * @throws {@link Error} Sources that do not type-check
 */
async function standaloneProject(
  prefix: string,
  files: readonly GeneratedFile[],
  consumers: readonly string[],
): Promise<string> {
  const root = await mkdtemp(resolve(prefix));
  roots.push(root);
  const assets: GeneratedFile[] = [...files];
  for (const name of consumers)
    assets.push({
      path: `typescript/${name}`,
      content: await readFile(
        new URL(`../../fixtures/typescript/${name}`, import.meta.url),
        "utf8",
      ),
    });
  const compilerOptions = {
    target: "ES2023",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    exactOptionalPropertyTypes: true,
    noUncheckedIndexedAccess: true,
    skipLibCheck: true,
    types: ["node"],
    lib: ["ES2023", "DOM", "DOM.Iterable"],
    outDir: "../dist",
  };
  assets.push({ path: "typescript/package.json", content: '{"type":"module"}\n' });
  assets.push({
    path: "typescript/tsconfig.json",
    content: JSON.stringify({ compilerOptions, include: ["*.ts"] }),
  });
  await materialize(root, assets);
  await typecheck(root, "tsconfig.json");
  return root;
}

/**
 * Generated numeric contract project that type-checked
 * @returns Project root directory
 * @throws {@link Error} Model that the target rejects
 */
export async function numericProject(): Promise<string> {
  const generated = renderTypeScript(
    await modelFrom("tests/fixtures/typescript/numeric.tsp", "Numeric"),
    options,
  );
  if (generated.isErr()) throw new Error(JSON.stringify(generated.error));
  return standaloneProject(".typescript-numeric-", generated.value, [
    "effect.ts",
    "check.ts",
    "numeric-consumer.ts",
  ]);
}

/**
 * Generated types and codecs of the hostile source-data contract that type-checked
 * @returns Project root directory
 * @throws {@link Error} Model that the target rejects
 */
export async function sourceDataProject(): Promise<string> {
  const generated = renderTypeScript(
    await modelFrom(
      "tests/fixtures/typescript/source-data.tsp",
      "SourceData",
      hostileContract("../../../lib/main.tsp"),
    ),
    options,
  );
  if (generated.isErr()) throw new Error(JSON.stringify(generated.error));
  return standaloneProject(
    ".typescript-source-data-",
    generated.value.filter((file) => file.path === "typescript/contract.ts"),
    ["check.ts", "source-data-consumer.ts"],
  );
}

/**
 * Lines of every documentation comment of a generated contract module, as the TypeScript compiler scans the comments
 * @param root - Generated project root
 * @returns Comment lines without comment markers, each with whitespace collapsed
 */
export async function documentationLines(root: string): Promise<ReadonlySet<string>> {
  const path = join(root, "typescript/contract.ts");
  const source = await readFile(path, "utf8");
  const lines = new Set<string>();
  const visit = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(source, node.getFullStart()) ?? [])
      if (range.kind === ts.SyntaxKind.MultiLineCommentTrivia)
        for (const line of source.slice(range.pos, range.end).split(/\r\n?|\n/))
          lines.add(
            line
              .replace(/\*\/\s*$/, "")
              .replace(/^\s*(?:\/\*\*?|\*)/, "")
              .replace(/[\s\u0085]+/g, " ")
              .trim(),
          );
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(path, source, ts.ScriptTarget.ES2023, true));
  return lines;
}

/**
 * Result lines of a consumer program run by Node
 * @param script - Compiled program path
 * @param args - Program arguments
 * @returns Reported checks by name
 */
export async function reportedChecks(
  script: string,
  args: readonly string[],
): Promise<ReadonlyMap<string, CheckLine>> {
  const { stdout } = await run(process.execPath, [script, ...args], {
    timeout: 150_000,
    maxBuffer: 16_000_000,
  });
  const lines = stdout.split("\n").filter((line) => line.startsWith("{"));
  return new Map(
    lines.map((line) => [(JSON.parse(line) as CheckLine).check, JSON.parse(line) as CheckLine]),
  );
}

/**
 * Node evaluation of a compiled module expression
 * @param root - Generated project root
 * @param module - Compiled module path relative to the root
 * @param expression - Expression over the imported module namespace `m`
 * @returns Standard output of the evaluation
 */
export async function evaluateModule(
  root: string,
  module: string,
  expression: string,
): Promise<string> {
  const href = new URL(`file://${join(root, module)}`).href;
  const program = `import * as m from ${JSON.stringify(href)}; console.log(${expression});`;
  const { stdout } = await run(process.execPath, ["--input-type=module", "--eval", program], {
    timeout: 30_000,
  });
  return stdout.trim();
}

/**
 * Removal of every generated project
 * @returns Completion after the directories were removed
 */
export async function cleanup(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
