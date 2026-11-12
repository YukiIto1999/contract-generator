import type { Operation } from "../model/contract-model.js";
import type { CompileState } from "./compile-state.js";

/** Route segment that matches any single path segment */
const placeholderSegment = /^\{[^{}]+\}$/;

/**
 * Contract-wide operation and transport identity uniqueness
 * @param state - Normalization state receiving the failures
 * @param operations - Complete normalized public operations
 */
export function checkOperationIdentities(
  state: CompileState,
  operations: readonly Operation[],
): void {
  const names = new Set<string>();
  const commands = new Set<string>();
  const routed: Operation[] = [];
  for (const operation of operations) {
    const target = state.targetAt(operation.origin);
    const key = operation.name.toLowerCase();
    if (names.has(key))
      state.issue(
        "naming-conflict",
        target,
        `Multiple operations generate the name ${operation.name}`,
        operation.id,
      );
    names.add(key);
    if (operation.ipc) {
      if (commands.has(operation.ipc.command))
        state.issue(
          "duplicate-ipc-command",
          target,
          `Multiple operations use command ${JSON.stringify(operation.ipc.command)}`,
          operation.id,
        );
      commands.add(operation.ipc.command);
    }
    if (operation.http) {
      for (const other of routed) reportRouteCollision(state, other, operation);
      routed.push(operation);
    }
  }
}

/**
 * Ambiguity of two HTTP routes that can match the same request
 * @param state - Normalization state receiving the failure
 * @param earlier - Previously registered HTTP operation
 * @param later - Newly registered HTTP operation
 */
function reportRouteCollision(state: CompileState, earlier: Operation, later: Operation): void {
  if (!earlier.http || !later.http || earlier.http.method !== later.http.method) return;
  if (!routesOverlap(earlier.http.path, later.http.path)) return;
  state.issue(
    "ambiguous-http-route",
    state.targetAt(later.origin),
    `HTTP routes for ${earlier.id} and ${later.id} can match the same request`,
    later.id,
  );
}

/**
 * Whether two route templates match a common path
 * @param left - First route template
 * @param right - Second route template
 * @returns Equal segment counts where every pair of segments is equal or has a placeholder side
 */
function routesOverlap(left: string, right: string): boolean {
  const leftSegments = left.split("/");
  const rightSegments = right.split("/");
  return (
    leftSegments.length === rightSegments.length &&
    leftSegments.every(
      (part, index) =>
        part === rightSegments[index] ||
        placeholderSegment.test(part) ||
        placeholderSegment.test(rightSegments[index] ?? ""),
    )
  );
}
