import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Audit receipt location below the repository root, outside the owned `work/native-dependencies` tree */
export const auditReceiptFile = "work/native-package-audit.json";
/** Environment variables naming the C# source projects whose package closure is audited */
export const auditedProjectVariables = [
  "TypeModelingProjectPath",
  "EffectSystemProjectPath",
] as const;
/** Receipt ownership and format identity */
const receiptOwner = "@yukiito1999/contract-generator/native-package-audit/v1";
/** NuGet audit diagnostic codes: NU1900 for unavailable vulnerability data, NU1901 to NU1904 for advisories, NU1905 for an audit source without data */
export const auditCodes = ["NU1900", "NU1901", "NU1902", "NU1903", "NU1904", "NU1905"];
/** Audit diagnostics in MSBuild's canonical error format */
const auditDiagnostic = /\b(?:warning|error) NU190[0-5]:/;
/** URL with its optional userinfo, and the query string and fragment that can carry tokens */
const urls = /\b([a-z][a-z0-9+.-]*:\/\/)(?:[^/\s@?#]*@)?([^\s?#]*)([?#]\S*)?/gi;

/** NuGet package identity (`Id/Version`) with the SHA-512 of its package archive */
export type PackageHash = readonly [identity: string, sha512: string];

/** Package reference metadata that can silence restore warnings */
interface DependencyMetadata {
  /** Warning codes that the reference suppresses */
  readonly noWarn?: readonly string[];
}

/** The parts of `project.assets.json` that audit coverage and audit settings read, whose shape NuGet guarantees */
export interface AssetsDocument {
  /** Resolved packages and projects by `Id/Version` */
  readonly libraries?: Readonly<
    Record<string, { readonly type?: string; readonly sha512?: string }>
  >;
  /** Restore inputs that NuGet evaluated for the project */
  readonly project?: {
    /** Evaluated restore settings */
    readonly restore?: {
      /** Evaluated `NuGetAudit*` settings and suppressed advisories */
      readonly restoreAuditProperties?: {
        readonly enableAudit?: string;
        readonly auditLevel?: string;
        readonly auditMode?: string;
        readonly suppressedAdvisories?: object | null;
      };
      /** Project-wide warning policy */
      readonly warningProperties?: DependencyMetadata;
    };
    /** Package references by target framework */
    readonly frameworks?: Readonly<
      Record<string, { readonly dependencies?: Readonly<Record<string, DependencyMetadata>> }>
    >;
  };
}

/** Receipt content before validation */
interface ReceiptDocument {
  /** Ownership identity written by this tool */
  readonly owner?: unknown;
  /** Instant at which the audit passed */
  readonly auditedAt?: unknown;
  /** Content hash by package identity */
  readonly packages?: unknown;
}

/** Audited package set of one passed audit */
export interface Receipt {
  /** ISO 8601 instant at which the audit passed, which is the newest advisory data it can reflect */
  readonly auditedAt: string;
  /** Content hash by package identity */
  readonly packages: ReadonlyMap<string, string>;
}

/** Text without credentials that a URL can carry
 * @param text - Tool output or diagnostic
 * @returns The text with every URL's userinfo removed and its query string and fragment replaced by `?<redacted>`
 */
export function redactCredentials(text: string): string {
  return text.replace(
    urls,
    (_url, scheme: string, rest: string, tail: string | undefined) =>
      `${scheme}${rest}${tail === undefined ? "" : "?<redacted>"}`,
  );
}

/** Lines of a report without an unbounded tail
 * @param lines - Complete report lines
 * @param limit - Largest number of lines to keep
 * @returns Text of at most `limit` lines that counts the omitted ones
 */
export function bounded(lines: readonly string[], limit: number): string {
  const shown = lines.slice(0, limit);
  const omitted = lines.length - shown.length;
  return (omitted > 0 ? [...shown, `[${omitted} more omitted]`] : shown).join("\n");
}

/** Audit diagnostics of one restore, each of which fails the audit
 * @param output - Standard output and error of `dotnet restore`
 * @returns Unique redacted diagnostic lines in output order
 */
export function auditFindings(output: string): string[] {
  const findings = output
    .split("\n")
    .filter((line) => auditDiagnostic.test(line))
    .map((line) => redactCredentials(line.trim()));
  return [...new Set(findings)];
}

/** Ways in which a restore's evaluated settings would leave the audit without effect
 * @param project - Project directory name that identifies the restore in the report
 * @param assets - Parsed `project.assets.json`
 * @returns One line per disabled, weakened or silenced audit setting; none when the settings audit every package
 */
export function auditSettingsProblems(project: string, assets: AssetsDocument): string[] {
  const restore = assets.project?.restore;
  const audit = restore?.restoreAuditProperties;
  const problems: string[] = [];
  if (audit?.enableAudit?.toLowerCase() !== "true") problems.push("the audit is disabled");
  if (audit?.auditLevel?.toLowerCase() !== "low")
    problems.push(`the audit level is ${audit?.auditLevel ?? "unset"}, not low`);
  if (audit?.auditMode?.toLowerCase() !== "all")
    problems.push(`the audit mode is ${audit?.auditMode ?? "unset"}, not all`);
  if (Object.keys(audit?.suppressedAdvisories ?? {}).length > 0)
    problems.push("advisories are suppressed");
  const references = Object.values(assets.project?.frameworks ?? {}).flatMap((framework) =>
    Object.values(framework.dependencies ?? {}),
  );
  const silenced = [restore?.warningProperties, ...references]
    .flatMap((metadata) => metadata?.noWarn ?? [])
    .map((code) => code.toUpperCase())
    .filter((code) => auditCodes.includes(code));
  if (silenced.length > 0)
    problems.push(`audit diagnostics are silenced: ${[...new Set(silenced)].join(", ")}`);
  return problems.map((problem) => `${project}: ${problem}`);
}

/** Packages that one restore resolved
 * @param assets - Parsed `project.assets.json`
 * @returns Every package library with the SHA-512 of its archive, excluding project libraries
 * @throws {@link Error} A package library without a content hash
 */
export function restoredPackages(assets: AssetsDocument): PackageHash[] {
  const packages: PackageHash[] = [];
  for (const [identity, library] of Object.entries(assets.libraries ?? {})) {
    if (library.type !== "package") continue;
    if (typeof library.sha512 !== "string" || library.sha512 === "")
      throw new Error(`The restored package ${identity} has no content hash`);
    packages.push([identity, library.sha512]);
  }
  return packages;
}

/** Restore assets below one SDK artifacts directory
 * @param artifactsRoot - Directory passed as `--artifacts-path`
 * @returns Project directory name and parsed `obj/<project>/project.assets.json` of every restored project
 * @throws {@link Error} Unreadable or malformed assets file
 */
function assetsBelow(artifactsRoot: string): [string, AssetsDocument][] {
  const objects = join(artifactsRoot, "obj");
  if (!existsSync(objects)) return [];
  const documents: [string, AssetsDocument][] = [];
  for (const entry of readdirSync(objects, { withFileTypes: true })) {
    const assets = join(objects, entry.name, "project.assets.json");
    if (entry.isDirectory() && existsSync(assets))
      documents.push([entry.name, JSON.parse(readFileSync(assets, "utf8")) as AssetsDocument]);
  }
  return documents;
}

/** Packages that every restore below one SDK artifacts directory resolved
 * @param artifactsRoot - Directory passed as `--artifacts-path`
 * @returns Packages of every restored project, repeated across projects that share them
 * @throws {@link Error} Unreadable assets file or a package library without a content hash
 */
export function restoredPackagesBelow(artifactsRoot: string): PackageHash[] {
  return assetsBelow(artifactsRoot).flatMap(([, assets]) => restoredPackages(assets));
}

/** Number of projects whose restore wrote assets below one SDK artifacts directory
 * @param artifactsRoot - Directory passed as `--artifacts-path`
 * @returns Count of `obj/<project>/project.assets.json` files
 * @throws {@link Error} Unreadable or malformed assets file
 */
export function restoredProjectCount(artifactsRoot: string): number {
  return assetsBelow(artifactsRoot).length;
}

/** Audit setting problems of every restore below one SDK artifacts directory
 * @param artifactsRoot - Directory passed as `--artifacts-path`
 * @returns Report lines of {@link auditSettingsProblems} for every restored project
 * @throws {@link Error} Unreadable or malformed assets file
 */
export function auditSettingsProblemsBelow(artifactsRoot: string): string[] {
  return assetsBelow(artifactsRoot).flatMap(([project, assets]) =>
    auditSettingsProblems(project, assets),
  );
}

/** Receipt of an audit that passed
 * @param packages - Every package the audited restores resolved
 * @param auditedAt - Instant at which the audit passed
 * @returns Receipt text with the audit instant and sorted package identities
 * @throws {@link Error} No package, or one package with two different content hashes
 */
export function serializeReceipt(packages: readonly PackageHash[], auditedAt: Date): string {
  const unique = new Map<string, string>();
  for (const [identity, hash] of packages) {
    const known = unique.get(identity);
    if (known !== undefined && known !== hash)
      throw new Error(`The package ${identity} restored with two different content hashes`);
    unique.set(identity, hash);
  }
  if (unique.size === 0) throw new Error("An audit that covers no package proves nothing");
  const sorted = [...unique].sort(([left], [right]) => (left < right ? -1 : Number(left > right)));
  const document = {
    owner: receiptOwner,
    auditedAt: auditedAt.toISOString(),
    packages: Object.fromEntries(sorted),
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Audited packages named by a receipt
 * @param text - Receipt file content
 * @returns The receipt, or nothing for text that this tool did not write
 */
export function parseReceipt(text: string): Receipt | undefined {
  let document: ReceiptDocument | null;
  try {
    document = JSON.parse(text) as ReceiptDocument | null;
  } catch {
    return undefined;
  }
  const packages = document?.packages;
  const auditedAt = document?.auditedAt;
  if (
    document?.owner !== receiptOwner ||
    typeof auditedAt !== "string" ||
    Number.isNaN(Date.parse(auditedAt)) ||
    typeof packages !== "object" ||
    packages === null ||
    Array.isArray(packages)
  )
    return undefined;
  const entries: [string, unknown][] = Object.entries(packages);
  const hashes = entries.filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "",
  );
  return hashes.length === 0 || hashes.length !== entries.length
    ? undefined
    : { auditedAt, packages: new Map(hashes) };
}

/** Restored packages that no audit covers
 * @param restored - Packages that restores resolved
 * @param audited - Content hash by package identity from the receipt
 * @returns Sorted unique identities that are absent from the audit or whose archive differs from the audited one
 */
export function unauditedPackages(
  restored: readonly PackageHash[],
  audited: ReadonlyMap<string, string>,
): string[] {
  const unaudited = restored.filter(([identity, hash]) => audited.get(identity) !== hash);
  return [...new Set(unaudited.map(([identity]) => identity))].sort();
}
