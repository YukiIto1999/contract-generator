import type { DiagnosticTarget } from "@typespec/compiler";
import type { IpcBinding } from "../model/binding-model.js";
import { compareText } from "../model/ordering.js";
import { authoredOutcome, type BindingContext } from "./binding-context.js";
import { hasControlCharacter } from "./http-tokens.js";
import type { OperationMetadata } from "./metadata.js";

/** IPC result declaration with its application target */
type IpcResultDeclaration = OperationMetadata["ipcResults"][number];

/**
 * Complete IPC command and result-tag interpretation
 * @param context - Binding context of the operation
 * @returns Complete IPC binding, or undefined when no command is declared
 */
export function compileIpc(context: BindingContext): IpcBinding | undefined {
  const { issue, metadata, origin } = context;
  if (metadata.ipc.length !== 1)
    issue(
      "ipc-binding-count",
      context.operation,
      "An IPC publication requires exactly one @ipcBinding declaration",
    );
  const command = metadata.ipc[0];
  if (!command) return undefined;
  if (!command.value || hasControlCharacter(command.value))
    issue(
      "invalid-ipc-command",
      command.target,
      "An IPC command must be nonempty and contain no control characters",
    );
  const results = compileResults(context);
  return { command: command.value, results, origin: origin(command.target) };
}

/**
 * Unique result tags validated for exhaustiveness
 * @param context - Binding context of the operation
 * @returns Tag mappings in canonical outcome order
 */
function compileResults(context: BindingContext): IpcBinding["results"][number][] {
  const mapped = new Set<string>();
  const tags = new Map<string, DiagnosticTarget>();
  const results: IpcBinding["results"][number][] = [];
  const entries = [...context.metadata.ipcResults].sort((left, right) =>
    compareText(left.value.outcome, right.value.outcome),
  );
  for (const entry of entries) {
    const outcome = context.outcomeNames.get(entry.value.outcome);
    if (!outcome) {
      context.issue(
        "unknown-outcome",
        entry.target,
        `No outcome named ${JSON.stringify(entry.value.outcome)}`,
      );
      continue;
    }
    checkOutcomeMapping(context, entry, outcome, mapped);
    checkTag(context, entry, tags);
    results.push({ outcome, tag: entry.value.tag, origin: context.origin(entry.target) });
  }
  for (const outcome of context.outcomes) {
    if (!mapped.has(outcome.name))
      context.issue(
        "missing-outcome-binding",
        context.operation,
        `Outcome ${authoredOutcome(context, outcome.name)} has no IPC mapping`,
      );
  }
  return results;
}

/**
 * Single mapping per outcome
 * @param context - Binding context of the operation
 * @param entry - Result declaration
 * @param outcome - Canonical outcome name the declaration names
 * @param mapped - Canonical outcome names that already have a mapping
 */
function checkOutcomeMapping(
  context: BindingContext,
  entry: IpcResultDeclaration,
  outcome: string,
  mapped: Set<string>,
): void {
  if (mapped.has(outcome))
    context.issue(
      "duplicate-outcome-binding",
      entry.target,
      `Outcome ${entry.value.outcome} has multiple IPC mappings`,
    );
  mapped.add(outcome);
}

/**
 * Nonempty tag identifying exactly one outcome
 * @param context - Binding context of the operation
 * @param entry - Result declaration
 * @param tags - Tags already declared with their declaration targets
 */
function checkTag(
  context: BindingContext,
  entry: IpcResultDeclaration,
  tags: Map<string, DiagnosticTarget>,
): void {
  const previous = tags.get(entry.value.tag);
  if (previous) {
    const reason = `IPC tag ${JSON.stringify(entry.value.tag)} identifies multiple outcomes`;
    context.issue("duplicate-ipc-tag", previous, reason);
    context.issue("duplicate-ipc-tag", entry.target, reason);
  } else tags.set(entry.value.tag, entry.target);
  if (!entry.value.tag)
    context.issue("empty-ipc-tag", entry.target, "An IPC outcome tag must not be empty");
}
