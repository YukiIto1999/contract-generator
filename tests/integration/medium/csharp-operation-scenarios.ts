import { baselineEnvelope } from "./csharp-codec-observation.js";

/** Binding through which the driver reaches the generated provider */
export type Binding = "direct" | "http" | "ipc";

/** Valid Envelope with a selected count and label
 * @param count - Handler-selecting count
 * @param label - Handler-selecting label
 * @returns Wire value
 */
export function envelope(count: number, label = "ok"): Record<string, unknown> {
  return { ...baselineEnvelope(), count, label };
}

/** Submission scenario for the driver
 * @param binding - direct, http or ipc
 * @param origin - HTTP server origin
 * @param input - Envelope wire value
 * @param limit - Optional limit including an explicit null
 * @param extra - Further scenario fields
 * @returns Driver request
 */
export function submit(
  binding: Binding,
  origin: string,
  input: unknown,
  limit?: unknown,
  extra: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    operation: "submit",
    binding,
    url: origin,
    payload: JSON.stringify({ input, ...(limit === undefined ? {} : { limit }) }),
    ...extra,
  };
}

/** One call scenario with its contract-derived expectation */
export type MatrixScenario = readonly [
  name: string,
  request: (binding: Binding, origin: string) => Record<string, unknown>,
  expected: Record<string, unknown>,
];

/** Input violations that no call path repairs
 * @param call - Submit request builder
 * @returns Rejection scenarios
 */
function rejectedInputs(
  call: (input: unknown, limit?: unknown) => MatrixScenario[1],
): readonly MatrixScenario[] {
  return [
    [
      "a null limit is rejected rather than repaired",
      call(envelope(1), null),
      { exit: "input", violations: [{ path: "/limit", rule: "null" }] },
    ],
    [
      "a zero limit is rejected rather than repaired",
      call(envelope(1), 0),
      { exit: "input", violations: [{ path: "/limit", rule: "minimum" }] },
    ],
    [
      "a limit above the range is rejected rather than repaired",
      call(envelope(1), 4),
      { exit: "input", violations: [{ path: "/limit", rule: "maximum" }] },
    ],
    [
      "an invalid nested input is rejected before dispatch",
      call(envelope(4)),
      { exit: "input", violations: [{ path: "/input/count", rule: "maximum" }] },
    ],
  ];
}

/** Outcomes that direct, HTTP and IPC calls must share
 * @returns Scenarios in report order
 */
export function matrixScenarios(): readonly MatrixScenario[] {
  const call =
    (input: unknown, limit?: unknown): MatrixScenario[1] =>
    (binding, origin) =>
      submit(binding, origin, input, limit);
  return [
    [
      "an unspecified limit receives the provider default",
      call(envelope(1)),
      { exit: "succeeded", case: "Created", value: "limit:3" },
    ],
    [
      "an explicit limit is kept",
      call(envelope(2), 2),
      { exit: "succeeded", case: "Queued", value: "limit:2" },
    ],
    [
      "the lower explicit boundary is kept",
      call(envelope(1), 1),
      { exit: "succeeded", case: "Created", value: "limit:1" },
    ],
    [
      "a void completion carries no value",
      call(envelope(3)),
      { exit: "succeeded", case: "Completed" },
    ],
    [
      "a declared rejection travels on the rejection path",
      call(envelope(1, "rej")),
      { exit: "declared", code: "invalid" },
    ],
    ...rejectedInputs(call),
    [
      "an empty binary success is distinct from an absent body",
      (binding, origin) => ({ operation: "download", binding, url: origin, payload: "{}" }),
      { exit: "succeeded", case: "Downloaded", bytes: "" },
    ],
  ];
}
