import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach } from "vite-plus/test";

/** Temporary parent directory and the output path inside it */
export interface PublicationSandbox {
  /** Directory that is removed after each test */
  parent: string;
  /** Output directory handed to the publication, absent until it is published */
  output: string;
}

/** Generation that publishes a nested and a top-level artifact */
export const first = [
  { path: "typescript/contract.ts", content: "first\n" },
  { path: "docs/reference.md", content: "reference\n" },
];

/** Generation that replaces one artifact and drops the other */
export const second = [{ path: "typescript/contract.ts", content: "second\n" }];

/** Per-test temporary parent directory with an output path that does not exist yet
 * @returns Sandbox whose paths are refreshed before and removed after every test
 */
export function usePublicationSandbox(): PublicationSandbox {
  const sandbox: PublicationSandbox = { parent: "", output: "" };
  beforeEach(async () => {
    sandbox.parent = await mkdtemp(join(tmpdir(), "contract-generator-publication-"));
    sandbox.output = join(sandbox.parent, "out");
  });
  afterEach(async () => {
    await rm(sandbox.parent, { recursive: true, force: true });
  });
  return sandbox;
}

/** Interrupted displacement layout after independently verified manual ownership release
 *
 * Recovery fixtures omit the ownership marker only after its separate manual release
 * The previous published tree remains in a sibling workspace
 * The staged directory has no unverified contents
 * @param output - Existing published output directory
 * @param suffix - Six-character random part of the workspace name
 * @returns Path of the leftover workspace
 */
export async function interruptReplacement(output: string, suffix = "Abc123"): Promise<string> {
  const workspace = join(
    dirname(output),
    `.${basename(output)}.contract-generator-publish-${suffix}`,
  );
  await mkdir(join(workspace, "staged"), { recursive: true });
  await rename(output, join(workspace, "previous"));
  return workspace;
}
