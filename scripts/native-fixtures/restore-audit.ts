import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Err, Ok, type Result } from "ts-results-es";
import {
  auditCodes,
  auditedProjectVariables,
  auditFindings,
  auditReceiptFile,
  auditSettingsProblemsBelow,
  bounded,
  redactCredentials,
  restoredPackagesBelow,
  restoredProjectCount,
  serializeReceipt,
  type PackageHash,
} from "./package-audit.ts";
import { restoreAuditProblems, restoreCountProperties } from "./restore-counts.ts";

/** Ceiling for one restore that may download packages and vulnerability data */
const restoreTimeout = 900_000;
/** Output ceiling of one restore at minimal verbosity */
const outputLimit = 64 * 1024 * 1024;
/** Largest number of output lines that a failure report repeats */
const reportedLines = 20;
/**
 * Properties that make a restore audit every package of every project in its graph, whatever those projects declare, and fail it on any audit diagnostic.
 * Static graph restore would not report NuGet's counts; `%3B` is the escaped list separator.
 */
const auditProperties = [
  "-p:NuGetAudit=true",
  "-p:NuGetAuditMode=all",
  "-p:NuGetAuditLevel=low",
  "-p:RestoreUseStaticGraphEvaluation=false",
  `-p:WarningsAsErrors=${auditCodes.join("%3B")}`,
  "-p:WarningsNotAsErrors=",
];
/** Messages in English and no telemetry, as the native test builds run */
const nativeEnvironment = {
  DOTNET_CLI_UI_LANGUAGE: "en",
  VSLANG: "1033",
  DOTNET_NOLOGO: "1",
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
};

/** Completed audit */
export interface AuditReport {
  /** Receipt that the offline native builds require */
  readonly receipt: string;
  /** Number of distinct packages that the audit covered */
  readonly packages: number;
}

/**
 * Command line of one forced restore of a fresh graph whose audit counts MSBuild writes to a file
 *
 * Only `dotnet msbuild` documents the `-get*` switches (`dotnet restore --help` lists none), so this runs the same `Restore` target through it with the properties that `dotnet restore` maps `--artifacts-path`, `--force` and `--no-http-cache` to.
 * @param project - Source project whose project-reference graph is restored
 * @param artifacts - Empty SDK artifacts directory that receives every `obj` of the graph
 * @param result - File that receives the restore count properties as JSON
 * @returns Arguments after the `dotnet` executable
 */
function restoreArguments(project: string, artifacts: string, result: string): string[] {
  return [
    "msbuild",
    project,
    "-target:Restore",
    `-getProperty:${restoreCountProperties.join(",")}`,
    `-getResultOutputFile:${result}`,
    `-p:ArtifactsPath=${artifacts}`,
    "-p:RestoreForce=true",
    "-p:RestoreNoHttpCache=true",
    "-nodeReuse:false",
    "-nologo",
    "-v:minimal",
    ...auditProperties,
  ];
}

/**
 * One online restore with its vulnerability audit
 * @param project - Source project whose project-reference graph is restored
 * @param artifacts - Empty SDK artifacts directory that receives every `obj` of the graph
 * @param env - Caller environment, which carries the NuGet configuration and credentials
 * @returns Success when the restore audited every project of its graph without any audit diagnostic, otherwise the redacted failure
 * @throws {@link Error} Filesystem failure or an unreadable assets file
 */
function restoreWithAudit(
  project: string,
  artifacts: string,
  env: NodeJS.ProcessEnv,
): Result<void, string> {
  const result = join(artifacts, "restore-counts.json");
  const run = spawnSync("dotnet", restoreArguments(project, artifacts, result), {
    encoding: "utf8",
    env: { ...env, ...nativeEnvironment },
    timeout: restoreTimeout,
    maxBuffer: outputLimit,
  });
  if (run.error !== undefined)
    return Err(`dotnet msbuild restore of ${project} did not complete: ${run.error.message}`);
  const output = `${run.stdout}${run.stderr}`;
  const findings = auditFindings(output);
  if (findings.length > 0)
    return Err(
      `The NuGet audit of ${project} did not pass; it needs network access to a NuGet source that publishes vulnerability data, and a reported advisory must be resolved rather than suppressed:\n${bounded(findings, reportedLines)}`,
    );
  if (run.status !== 0) {
    const tail = redactCredentials(output)
      .split("\n")
      .filter((line) => line.trim() !== "")
      .slice(-reportedLines);
    return Err(
      `dotnet msbuild restore of ${project} exited with status ${run.status}:\n${tail.join("\n")}`,
    );
  }
  const counts = existsSync(result) ? readFileSync(result, "utf8") : undefined;
  const problems = restoreAuditProblems(counts, restoredProjectCount(artifacts));
  return problems.length === 0
    ? Ok.EMPTY
    : Err(
        `The restore of ${project} did not prove that it audited its projects:\n${bounded(problems, reportedLines)}`,
      );
}

/**
 * Restore, audit and settings check of one source project in its own fresh artifacts directory
 * @param project - Source project whose project-reference graph is audited
 * @param env - Caller environment, which carries the NuGet configuration and credentials
 * @returns Every package that the restore resolved, or the redacted failure
 * @throws {@link Error} Filesystem failure, a package library without a content hash or an unreadable assets file
 */
function auditProject(project: string, env: NodeJS.ProcessEnv): Result<PackageHash[], string> {
  const artifacts = mkdtempSync(join(tmpdir(), "native-package-audit-"));
  try {
    const restored = restoreWithAudit(project, artifacts, env);
    if (restored.isErr()) return restored;
    const problems = auditSettingsProblemsBelow(artifacts);
    return problems.length === 0
      ? Ok(restoredPackagesBelow(artifacts))
      : Err(`The restores did not audit every package:\n${bounded(problems, reportedLines)}`);
  } finally {
    rmSync(artifacts, { recursive: true, force: true });
  }
}

/**
 * Online restore and vulnerability audit of the exact package closure of C# source projects
 * @param projects - Source projects, whose project references are restored with them
 * @param env - Caller environment, which carries the NuGet configuration and credentials
 * @returns Every package that the audited restores resolved, or the first failure
 * @throws {@link Error} Filesystem failure, a package library without a content hash or an unreadable assets file
 */
export function auditProjects(
  projects: readonly string[],
  env: NodeJS.ProcessEnv,
): Result<PackageHash[], string> {
  const packages: PackageHash[] = [];
  for (const project of projects) {
    const audited = auditProject(project, env);
    if (audited.isErr()) return audited;
    packages.push(...audited.value);
  }
  return Ok(packages);
}

/**
 * Audit of the C# sources that the native builds use, recorded for their offline restores
 * @param root - Repository root that owns `work/`
 * @param env - Caller environment, which names the source projects and carries the NuGet configuration
 * @returns The receipt location and package count, or the redacted failure that leaves any earlier receipt untouched
 * @throws {@link Error} Filesystem failure, or a package library without a content hash
 */
export function auditNativePackages(
  root: string,
  env: NodeJS.ProcessEnv,
): Result<AuditReport, string> {
  const projects: string[] = [];
  for (const name of auditedProjectVariables) {
    const project = env[name];
    if (project === undefined || project === "")
      return Err(`${name} is not set; enter devenv shell or export the source project path`);
    projects.push(project);
  }
  const audited = auditProjects(projects, env);
  if (audited.isErr()) return audited;
  const receipt = join(root, auditReceiptFile);
  const staging = `${receipt}.${process.pid}.tmp`;
  mkdirSync(dirname(receipt), { recursive: true });
  writeFileSync(staging, serializeReceipt(audited.value, new Date()));
  renameSync(staging, receipt);
  return Ok({ receipt, packages: new Set(audited.value.map(([identity]) => identity)).size });
}
