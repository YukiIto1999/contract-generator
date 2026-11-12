import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { Err, Ok, type Result } from "ts-results-es";
import type { GeneratedFile } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";
import { refusal, type PublicationFailure } from "./publication-result.js";

/** Ownership marker independent of a package release number */
const generatorName = "@yukiito1999/contract-generator";
/** Reserved completion marker published with the complete artifact tree */
export const manifestName = ".contract-generator.json";

/** Artifact identity used for edit protection and drift comparison */
export interface FileDigest {
  /** Portable relative artifact path */
  readonly path: string;
  /** SHA-256 of the UTF-8 artifact bytes */
  readonly sha256: string;
}

/** Previous successful generation and its owned paths */
export interface OutputManifest {
  /** Marker owner */
  readonly generator: typeof generatorName;
  /** Ownership format version */
  readonly format: 1;
  /** Ordinally ordered artifact identities */
  readonly files: readonly FileDigest[];
}

/** Non-array JSON object membership
 * @param value - Untrusted ownership marker value
 * @returns Object membership without a value assertion
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Destination-contained artifact path membership
 * @param path - Emitter-produced relative path
 * @returns Membership of the owned portable path domain
 */
function isArtifactPath(path: string): boolean {
  return (
    path !== manifestName &&
    path.length > 0 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.includes(":") &&
    path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

/** Ordinal path ordering independent of locale
 * @param left - First artifact identity
 * @param right - Second artifact identity
 * @returns Stable lexical order
 */
function comparePaths(left: FileDigest, right: FileDigest): number {
  return compareText(left.path, right.path);
}

/** Exact artifact byte identity
 * @param content - UTF-8 text or existing file bytes
 * @returns Lowercase SHA-256 digest
 */
export function digest(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Identity of every artifact of one generation
 * @param files - Every required target after successful rendering
 * @returns Ordinally ordered manifest or a refusal of an invalid or duplicate path
 */
export function describeArtifacts(
  files: readonly GeneratedFile[],
): Result<OutputManifest, PublicationFailure> {
  const paths = new Set<string>();
  const identities: FileDigest[] = [];
  for (const file of files) {
    if (!isArtifactPath(file.path) || paths.has(file.path))
      return Err(
        refusal("invalid-artifact", "Invalid or duplicate emitted artifact path: " + file.path),
      );
    paths.add(file.path);
    identities.push({ path: file.path, sha256: digest(file.content) });
  }
  identities.sort(comparePaths);
  return Ok({ generator: generatorName, format: 1, files: identities });
}

/** Strict interpretation of an existing ownership marker
 * @param text - Existing marker bytes decoded as UTF-8
 * @returns Verified ownership information or absence of valid ownership
 * @throws {@link Error} A defect other than the syntax error of malformed JSON
 */
export function parseManifest(text: string): OutputManifest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    value.generator !== generatorName ||
    value.format !== 1 ||
    !Array.isArray(value.files)
  )
    return undefined;
  const files: FileDigest[] = [];
  const paths = new Set<string>();
  for (const entry of value.files as readonly unknown[]) {
    if (
      !isRecord(entry) ||
      Object.keys(entry).length !== 2 ||
      typeof entry.path !== "string" ||
      !isArtifactPath(entry.path) ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      paths.has(entry.path)
    )
      return undefined;
    paths.add(entry.path);
    files.push({ path: entry.path, sha256: entry.sha256 });
  }
  files.sort(comparePaths);
  return { generator: generatorName, format: 1, files };
}

/** Parent directories owned by a declared artifact set
 * @param files - Previously published files
 * @returns Relative directory identities without the output root
 */
export function ownedDirectories(files: readonly FileDigest[]): Set<string> {
  const directories = new Set<string>();
  for (const file of files) {
    const segments = file.path.split("/");
    segments.pop();
    while (segments.length > 0) {
      directories.add(segments.join("/"));
      segments.pop();
    }
  }
  return directories;
}

/** Identical successful generation membership
 * @param previous - Verified previous marker
 * @param next - Complete new artifact identities
 * @returns Equality of every path and byte identity
 */
export function sameOutput(
  previous: OutputManifest | null | undefined,
  next: OutputManifest,
): boolean {
  return (
    previous !== undefined &&
    previous !== null &&
    previous.files.length === next.files.length &&
    previous.files.every(
      (file, index) =>
        file.path === next.files[index]?.path && file.sha256 === next.files[index]?.sha256,
    )
  );
}
