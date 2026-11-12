import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { compareText } from "../../../src/model/ordering.js";

const run = promisify(execFile);
/** Checkout that the compiler loads as the emitter package */
const repository = resolve(import.meta.dirname, "../../..");
/** TypeSpec compiler entry point */
const cli = join(repository, "node_modules/@typespec/compiler/cmd/tsp.js");

/** Exit code and combined output of one compiler run */
export interface CompilerRun {
  /** Process exit code, nonzero for a failed compilation */
  readonly code: number;
  /** Standard output followed by standard error */
  readonly text: string;
}

/** Shared contract source with the library import made absolute so it compiles anywhere
 * @returns Contract source that imports this checkout's library
 * @throws {@link Error} The shared contract no longer imports the library through its relative path
 */
export async function loadFixture(): Promise<string> {
  const source = await readFile(join(repository, "tests/fixtures/contracts/main.tsp"), "utf8");
  const fixture = source.replace(
    'import "../../../lib/main.tsp";',
    `import ${JSON.stringify(join(repository, "lib/main.tsp"))};`,
  );
  if (fixture === source) throw new Error("The shared contract does not import the library");
  return fixture;
}

/** Compiler invocation through the published emitter entry
 * @param directory - Project directory that receives the source, the configuration and `out`
 * @param source - Contract source
 * @param check - Read-only comparison instead of publication
 * @returns Exit code and output of the compilation
 */
export async function generate(
  directory: string,
  source: string,
  check = false,
): Promise<CompilerRun> {
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "main.tsp"), source);
  await writeFile(
    join(directory, "tspconfig.yaml"),
    [
      "emit:",
      `  - ${JSON.stringify(repository)}`,
      "options:",
      '  "@yukiito1999/contract-generator":',
      '    emitter-output-dir: "{project-root}/out"',
      "    namespace: Sample",
      "    targets: [typescript, csharp, rust]",
      '    typescript-effect-module: "./effect.js"',
      `    check: ${String(check)}`,
      "",
    ].join("\n"),
  );
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, "compile", "main.tsp"], {
      cwd: directory,
    });
    return { code: 0, text: stdout + stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failed.code ?? -1, text: (failed.stdout ?? "") + (failed.stderr ?? "") };
  }
}

/** Byte identity of every published file
 * @param directory - Published output directory
 * @param relative - Directory below the output that is being listed
 * @returns SHA-256 of every file keyed by its path below the output
 */
export async function digests(directory: string, relative = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const entries = await readdir(join(directory, relative), { withFileTypes: true });
  for (const entry of entries.sort((left, right) => compareText(left.name, right.name))) {
    const path = relative === "" ? entry.name : relative + "/" + entry.name;
    if (entry.isDirectory()) Object.assign(result, await digests(directory, path));
    else
      result[path] = createHash("sha256")
        .update(await readFile(join(directory, path)))
        .digest("hex");
  }
  return result;
}
