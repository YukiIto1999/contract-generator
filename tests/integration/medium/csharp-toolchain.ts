import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeneratedFile } from "../../../src/model/contract-model.js";
import { renderCSharp } from "../../../src/targets/csharp/render-csharp.js";
import { options } from "../../../src/targets/csharp/test-models.js";
import { contractModel } from "./csharp-contract.js";

/** Independent fixture directory shipped with the generator tests */
const fixtureSource = fileURLToPath(new URL("../../fixtures/csharp/", import.meta.url));
/** Minimum .NET SDK major version required by the generated C# 14 projects */
const requiredDotnetMajor = 10;
/** Generous process ceiling for a real native process on a shared workstation */
export const nativeTimeout = 180_000;
/** Pinned dependency source locations supplied by the development environment */
const dependencyVariables = ["TypeModelingProjectPath", "EffectSystemProjectPath"];

/** Whether the pinned native toolchain can run the generated C# */
export type CSharpToolchain =
  | { /** Toolchain complete */ readonly available: true }
  | {
      /** Toolchain incomplete */ readonly available: false;
      /** Missing prerequisite reported as not run */ readonly reason: string;
    };

/** Native toolchain prerequisite inspection without building
 * @returns Availability or the exact missing prerequisite
 */
export function detectCSharpToolchain(): CSharpToolchain {
  const unavailable = (reason: string): CSharpToolchain => ({ available: false, reason });
  const probe = spawnSync("dotnet", ["--version"], { encoding: "utf8", timeout: nativeTimeout });
  if (probe.error !== undefined || probe.status !== 0)
    return unavailable(
      "the dotnet executable is not runnable here (enter `devenv shell` from the repository root)",
    );
  const major = Number.parseInt(probe.stdout.trim().split(".")[0] ?? "", 10);
  if (!(major >= requiredDotnetMajor))
    return unavailable(`.NET SDK ${probe.stdout.trim()} is older than ${requiredDotnetMajor}`);
  for (const variable of dependencyVariables) {
    const path = process.env[variable];
    if (path === undefined || path === "")
      return unavailable(
        `${variable} is not set (enter \`devenv shell\` from the repository root)`,
      );
    if (!existsSync(path))
      return unavailable(
        `${variable} points at ${path}, which does not exist (run \`npm run prepare:native\`)`,
      );
  }
  return { available: true };
}

/** One compiler or MSBuild diagnostic */
export interface BuildDiagnostic {
  /** Diagnostic severity */
  readonly severity: "warning" | "error";
  /** Compiler diagnostic identifier */
  readonly code: string;
  /** Complete diagnostic line including file position */
  readonly text: string;
}

/** Result of one native `dotnet build` */
export interface NativeBuild {
  /** Process exit status */
  readonly status: number | null;
  /** Unique diagnostics in output order */
  readonly diagnostics: readonly BuildDiagnostic[];
  /** Complete build output retained for failure reports */
  readonly output: string;
}

/** Generated contract plus a private copy of the fixture projects */
export interface CSharpFixture {
  /** Test-owned directory containing both trees */
  readonly root: string;
  /** Directory containing the generated `csharp/types`, `csharp/provider`, `csharp/client` units */
  readonly generatedRoot: string;
  /** Copy of `tests/fixtures/csharp` without prior build output */
  readonly fixtureRoot: string;
}

/** Writing generated files and a clean fixture-project copy into a test-owned directory
 * @param root - Existing empty test-owned directory
 * @param files - Complete generated C# files with `csharp/` paths
 * @returns Locations for the native builds
 */
export async function provisionCSharpFixture(
  root: string,
  files: readonly GeneratedFile[],
): Promise<CSharpFixture> {
  const generatedRoot = join(root, "generated");
  const fixtureRoot = join(root, "fixture");
  for (const file of files) {
    const path = join(generatedRoot, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, file.content);
  }
  await cp(fixtureSource, fixtureRoot, {
    recursive: true,
    filter: (source) => !/^(bin|obj)$/.test(source.split("/").pop() ?? ""),
  });
  return { root, generatedRoot, fixtureRoot };
}

/** Environment forcing stable English compiler messages without changing caller-owned toolchain settings */
const nativeEnvironment = {
  ...process.env,
  DOTNET_CLI_UI_LANGUAGE: "en",
  VSLANG: "1033",
  DOTNET_NOLOGO: "1",
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
};

/** Unique compiler diagnostics of a build output
 * @param output - Standard output and error of the build
 * @returns Diagnostics in output order
 */
function parseDiagnostics(output: string): readonly BuildDiagnostic[] {
  const seen = new Set<string>();
  const diagnostics: BuildDiagnostic[] = [];
  for (const line of output.split("\n")) {
    const match = /\b(warning|error) ([A-Z]{2,}[0-9]+):/.exec(line);
    if (match === null || seen.has(line.trim())) continue;
    seen.add(line.trim());
    diagnostics.push({
      severity: match[1] as "warning" | "error",
      code: match[2]!,
      text: line.trim(),
    });
  }
  return diagnostics;
}

/** Native build of one fixture project against the generated contract
 * @param fixture - Provisioned directories
 * @param project - Project file name inside the fixture copy
 * @param properties - Additional MSBuild properties
 * @returns Exit status and unique diagnostics
 */
export function buildCSharpProject(
  fixture: CSharpFixture,
  project: string,
  properties: Readonly<Record<string, string>> = {},
): NativeBuild {
  const args = [
    "build",
    join(fixture.fixtureRoot, project),
    `-p:GeneratedContractRoot=${fixture.generatedRoot}`,
    ...Object.entries(properties).map(([key, value]) => `-p:${key}=${value}`),
    "--disable-build-servers",
    "-nologo",
    "-v:minimal",
  ];
  const run = spawnSync("dotnet", args, {
    cwd: fixture.fixtureRoot,
    encoding: "utf8",
    timeout: 600_000,
    env: nativeEnvironment,
  });
  const output = `${run.stdout}${run.stderr}`;
  return {
    status: run.error === undefined ? run.status : null,
    diagnostics: parseDiagnostics(output),
    output,
  };
}

/** Built fixture assembly location
 * @param fixture - Provisioned directories
 * @param name - Fixture project name without extension
 * @returns Absolute main assembly path
 */
export function driverAssembly(fixture: CSharpFixture, name: string): string {
  return join(fixture.fixtureRoot, "bin", name, "Debug", "net10.0", `${name}.dll`);
}

/** Source checkouts of the pinned dependencies, whose own diagnostics are not generated code
 * @returns Checkout directories including their real paths
 */
function dependencyRoots(): readonly string[] {
  return dependencyVariables.flatMap((variable) => {
    const project = process.env[variable];
    if (project === undefined || project === "") return [];
    const checkout = resolve(dirname(project), "..", "..");
    return [checkout, realpathSync(checkout)];
  });
}

/** Diagnostics attributed to generated or fixture sources; anything not provably a dependency's counts against the generator
 * @param build - Native build result
 * @returns Diagnostics outside the pinned dependency checkouts
 */
export function generatedDiagnostics(build: NativeBuild): readonly BuildDiagnostic[] {
  const roots = dependencyRoots();
  return build.diagnostics.filter(
    (diagnostic) => !roots.some((root) => diagnostic.text.includes(root)),
  );
}

/** Provisioned fixture of one contract with its driver builds */
export interface BuiltContract {
  /** Provisioned directories */
  readonly fixture: CSharpFixture;
  /** Build result per driver project file */
  readonly builds: ReadonlyMap<string, NativeBuild>;
}

/** Provisioned fixture of one contract with its named driver projects built
 * @param source - Checkout-relative TypeSpec source path
 * @param namespace - Selected public contract
 * @param projects - Driver project files to build
 * @returns Fixture and one build per project; throws when a build fails
 * @throws {@link Error} A contract that does not render or a driver that does not build
 */
export async function buildContract(
  source: string,
  namespace: string,
  projects: readonly string[],
): Promise<BuiltContract> {
  const rendered = renderCSharp(await contractModel(source, namespace), {
    ...options,
    csharpNamespace: namespace,
  });
  if (rendered.isErr()) throw new Error(JSON.stringify(rendered.error));
  const fixture = await provisionCSharpFixture(
    await mkdtemp(join(tmpdir(), `contract-csharp-${namespace.toLowerCase()}-`)),
    rendered.value,
  );
  const builds = new Map<string, NativeBuild>();
  for (const project of projects) {
    const build = buildCSharpProject(fixture, project);
    if (build.status !== 0) throw new Error(`${project} build failed:\n${build.output}`);
    builds.set(project, build);
  }
  return { fixture, builds };
}
