import { execFileSync } from "node:child_process";
import { readReceipt } from "./evidence.ts";
import { commitChecks, nativeChecks } from "./plan.ts";
import { releaseSummary } from "./release-summary.ts";

/** Ignored local verification state that `verify:push` writes */
const directory = "work/verification";

/** Output of one git command
 * @param args - Arguments after `git`
 * @returns Trimmed standard output
 */
function git(...args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

/** Prints the text of the annotated release tag, built from the stored `verify:push` receipts
 * @throws {@link Error} A checkout with uncommitted changes, or a receipt that is missing or did not pass
 */
function main(): void {
  if (git("status", "--porcelain") !== "")
    throw new Error(
      "The checkout has uncommitted changes; summarize the commit that the tag names",
    );
  const receipts = Object.fromEntries(
    [...commitChecks, ...nativeChecks].map((check) => [check, readReceipt(directory, check)]),
  );
  process.stdout.write(releaseSummary(git("rev-parse", "HEAD"), receipts));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
