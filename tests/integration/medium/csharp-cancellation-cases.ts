import { envelope, submit, type Binding } from "./csharp-operation-scenarios.js";

/** One cancellation or deadline scenario with its host-owned expectation */
export type CancellationScenario = readonly [
  name: string,
  request: Record<string, unknown>,
  expected: Record<string, unknown>,
];

/** Canceled exit observation
 * @param reason - Host-owned reason
 * @returns Expected observation
 */
function canceled(reason: string): Record<string, unknown> {
  return { exit: "canceled", reason };
}

/** Cancellation and deadline scenarios that every binding must answer alike
 * @param binding - direct, http or ipc
 * @param origin - HTTP server origin
 * @returns Scenarios in report order
 */
export function cancellationScenarios(
  binding: Binding,
  origin: string,
): readonly CancellationScenario[] {
  const past = new Date(Date.now() - 60_000).toISOString();
  const call = (label: string, extra: Record<string, unknown>): Record<string, unknown> =>
    submit(binding, origin, envelope(1, label), undefined, extra);
  const completed = { exit: "succeeded", case: "Completed" };
  return [
    ["cancellation before start", call("ok", { cancel: "before" }), canceled("parent")],
    [
      "cancellation after completion keeps the completed result",
      call("ok", { cancel: "after" }),
      { exit: "succeeded", case: "Created", value: "limit:3" },
    ],
    [
      "cancellation while the handler or transport is running",
      call("zzz", { cancelAfterMs: 50 }),
      canceled("parent"),
    ],
    [
      "a host deadline that expires while running",
      call("zzz", { deadlineAfterMs: 50 }),
      { exit: "transport", reason: "deadline" },
    ],
    [
      "a host deadline that expired before the call",
      call("ok", { deadline: past }),
      { exit: "transport", reason: "deadline" },
    ],
    [
      "parent cancellation is reported ahead of an expired deadline",
      call("ok", { cancel: "before", deadline: past }),
      canceled("parent"),
    ],
    [
      "a distant deadline preserves the completed result",
      call("zzz", { deadlineAfterMs: 600_000 }),
      completed,
    ],
    ["no cancellation lets the slow handler complete", call("zzz", {}), completed],
    [
      "binary operation cancellation before start",
      { operation: "download", binding, url: origin, payload: "{}", cancel: "before" },
      canceled("parent"),
    ],
  ];
}
