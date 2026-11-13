import type { SpawnSyncReturns } from "node:child_process";
import { expect } from "vite-plus/test";

/** Rust compiler diagnostic of a path package */
export interface CompilerMessage {
  readonly level: string;
  readonly code: string | null;
  readonly rendered: string;
  readonly source: string;
}
/** Maximum displayed lines of one representative diagnostic, without limiting error accounting */
const exampleLines = 30;

/** One compiler error category with its complete count and a bounded real example */
interface ErrorGroup {
  /** Rust error code, or the diagnostic heading when no code exists */
  readonly category: string;
  /** Number of compiler diagnostics in the category */
  count: number;
  /** First actual diagnostic, retaining its heading and source location */
  readonly example: string;
}

/** Compiler errors grouped without dumping repeated generated-code failures
 * @param messages - Complete parsed Cargo compiler messages
 * @returns Every error category and occurrence count with one bounded representative
 */
function errorGroups(messages: readonly CompilerMessage[]): readonly ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  for (const message of messages) {
    if (message.level !== "error") continue;
    const lines = message.rendered.split("\n");
    const category = message.code ?? lines[0] ?? "error";
    const existing = groups.get(category);
    if (existing !== undefined) {
      existing.count += 1;
      continue;
    }
    const omitted = lines.length - exampleLines;
    const example =
      lines.slice(0, exampleLines).join("\n") +
      (omitted > 0 ? `\n[${omitted} diagnostic lines omitted]` : "");
    groups.set(category, { category, count: 1, example });
  }
  return [...groups.values()];
}

/** Successful Cargo completion with no generated or fixture warnings
 * @param root - Owned checkout root selecting local warning sources
 * @param outcome - Cargo process exit and stderr
 * @param messages - Compiler events from Cargo stdout
 * @throws {@link Error} Nonzero exit or local warning, with actual compiler errors retained in the assertion
 */
export function assertCleanCargo(
  root: string,
  outcome: Pick<SpawnSyncReturns<string>, "status" | "stderr">,
  messages: readonly CompilerMessage[],
): void {
  const warnings = messages
    .filter((message) => message.source.startsWith(root) && message.level === "warning")
    .map((message) => message.rendered);
  expect({
    status: outcome.status,
    stderr: outcome.status === 0 ? "" : outcome.stderr,
    errors: errorGroups(messages),
    warnings,
  }).toEqual({ status: 0, stderr: "", errors: [], warnings: [] });
}
