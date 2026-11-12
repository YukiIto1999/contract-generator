import { expect } from "vite-plus/test";
import { exchange, essence, runWorker } from "./csharp-process.js";
import { envelope } from "./csharp-operation-scenarios.js";

/** Request media type of the JSON bindings */
const json = { "content-type": "application/json" };

/** JSON request body of a submission
 * @param input - Envelope wire value
 * @param extra - Further top-level members
 * @returns Body text
 */
function body(input: unknown, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ input, ...extra });
}

/** Parsed JSON body of a response
 * @param response - Observed response
 * @returns Parsed value
 */
function parsed(response: { readonly body: Buffer }): unknown {
  return JSON.parse(response.body.toString("utf8"));
}

/** Provider default and result selection by status over a real socket
 * @param origin - Listener origin
 */
export async function expectDefaultAndStatusSelection(origin: string): Promise<void> {
  const unspecified = await exchange(origin, "POST", "/submit", json, body(envelope(1)));
  expect([
    unspecified.status,
    essence(unspecified.headers["content-type"]),
    parsed(unspecified),
  ]).toEqual([201, "application/json", { value: "limit:3" }]);
  const explicit = await exchange(origin, "POST", "/submit", json, body(envelope(2), { limit: 2 }));
  expect([explicit.status, parsed(explicit)]).toEqual([202, { value: "limit:2" }]);
  const completed = await exchange(origin, "POST", "/submit", json, body(envelope(3)));
  expect([completed.status, completed.body.length, completed.headers["content-type"]]).toEqual([
    204,
    0,
    undefined,
  ]);
  const rejected = await exchange(origin, "POST", "/submit", json, body(envelope(1, "rej")));
  expect([rejected.status, essence(rejected.headers["content-type"]), parsed(rejected)]).toEqual([
    400,
    "application/json",
    { code: "invalid", message: "fixture rejection" },
  ]);
}

/** Null and out-of-range limits rejected before the handler
 * @param origin - Listener origin
 */
export async function expectLimitRejection(origin: string): Promise<void> {
  for (const [limit, rule] of [
    [null, "null"],
    [0, "minimum"],
    [4, "maximum"],
  ] as const) {
    const response = await exchange(origin, "POST", "/submit", json, body(envelope(1), { limit }));
    expect([response.status, essence(response.headers["content-type"])]).toEqual([
      400,
      "application/problem+json",
    ]);
    expect(parsed(response)).toEqual({ failure: "input", violations: [{ path: "/limit", rule }] });
  }
  const invalid = await exchange(origin, "POST", "/submit", json, body(envelope(4)));
  expect(parsed(invalid)).toEqual({
    failure: "input",
    violations: [{ path: "/input/count", rule: "maximum" }],
  });
}

/** Malformed requests reported as normal violations
 * @param origin - Listener origin
 */
export async function expectMalformedRequests(origin: string): Promise<void> {
  const surrogate = `{"input":${JSON.stringify({ ...envelope(1), label: "LABEL" }).replace('"LABEL"', '"\\ud800"')}}`;
  const cases: readonly (readonly [
    string,
    Record<string, string>,
    string,
    { path: string; rule: string },
  ])[] = [
    [
      "wrong media type",
      { "content-type": "text/plain" },
      body(envelope(1)),
      { path: "", rule: "type" },
    ],
    ["malformed JSON", json, "{", { path: "", rule: "json" }],
    ["JSON null body", json, "null", { path: "", rule: "type" }],
    ["array body", json, "[]", { path: "", rule: "type" }],
    ["empty object body", json, "{}", { path: "/input", rule: "required" }],
    ["empty body", json, "", { path: "/input", rule: "required" }],
    [
      "unpaired surrogate escape in a value",
      json,
      surrogate,
      { path: "/input/label", rule: "format" },
    ],
  ];
  for (const [name, headers, payload, violation] of cases) {
    const response = await exchange(origin, "POST", "/submit", headers, payload);
    expect(response.status, name).toBe(400);
    expect(parsed(response), name).toEqual({ failure: "input", violations: [violation] });
  }
}

/** Unknown members accepted without echoing their values
 * @param origin - Listener origin
 */
export async function expectUnknownMembersDropped(origin: string): Promise<void> {
  const input = {
    ...envelope(1),
    items: [{ kind: "text", text: "😀", future: { secret: "must-not-appear" } }],
    extraEnvelope: "must-not-appear",
  };
  const response = await exchange(
    origin,
    "POST",
    "/submit",
    json,
    body(input, { extraTop: "must-not-appear" }),
  );
  expect(response.status).toBe(201);
  expect(response.body.toString("utf8")).not.toContain("must-not-appear");
}

/** Undeclared routes and methods plus the bodyless request rule
 * @param origin - Listener origin
 */
export async function expectRouting(origin: string): Promise<void> {
  expect((await exchange(origin, "GET", "/nothing")).status).toBe(404);
  expect((await exchange(origin, "GET", "/submit")).status).toBe(404);
  expect((await exchange(origin, "POST", "/download", json, "{}")).status).toBe(404);
  const download = await exchange(origin, "GET", "/download");
  expect([
    download.status,
    essence(download.headers["content-type"]),
    download.body.length,
  ]).toEqual([200, "application/octet-stream", 0]);
  const withBody = await exchange(origin, "GET", "/download", { "content-length": "1" }, "x");
  expect([withBody.status, parsed(withBody)]).toEqual([
    400,
    { failure: "input", violations: [{ path: "", rule: "type" }] },
  ]);
}

/** Resolved IPC envelopes with their own tags
 * @param driver - Built OperationDriver.dll path
 */
export function expectResolvedEnvelopes(driver: string): void {
  const run = (command: string, parameters: string): readonly [number | null, unknown] => {
    const result = runWorker(driver, { command, parameters });
    return [result.status, JSON.parse(result.stdout)];
  };
  const parameters = (input: unknown, extra: Record<string, unknown> = {}): string =>
    body(input, extra);
  expect(run("submit", parameters(envelope(1)))).toEqual([
    0,
    { tag: "created", body: { value: "limit:3" } },
  ]);
  expect(run("submit", parameters(envelope(2), { limit: 2 }))).toEqual([
    0,
    { tag: "queued", body: { value: "limit:2" } },
  ]);
  const completed = run("submit", parameters(envelope(3)));
  expect(completed).toEqual([0, { tag: "completed" }]);
  expect("body" in (completed[1] as object)).toBe(false);
  expect(run("submit", parameters(envelope(1, "rej")))).toEqual([
    0,
    { tag: "rejected", body: { code: "invalid", message: "fixture rejection" } },
  ]);
  expect(run("download", "{}")).toEqual([0, { tag: "downloaded", body: "" }]);
}

/** IPC input failures that never produce a resolved envelope
 * @param driver - Built OperationDriver.dll path
 */
export function expectIpcInputFailures(driver: string): void {
  const cases: readonly (readonly [string, string, { path: string; rule: string }])[] = [
    ["null limit", body(envelope(1), { limit: null }), { path: "/limit", rule: "null" }],
    ["zero limit", body(envelope(1), { limit: 0 }), { path: "/limit", rule: "minimum" }],
    ["limit above the range", body(envelope(1), { limit: 4 }), { path: "/limit", rule: "maximum" }],
    ["invalid nested input", body(envelope(4)), { path: "/input/count", rule: "maximum" }],
    ["missing input", "{}", { path: "/input", rule: "required" }],
    ["malformed parameters", "{", { path: "", rule: "json" }],
  ];
  for (const [name, parameters, violation] of cases) {
    const run = runWorker(driver, { command: "submit", parameters });
    expect([run.status, run.stdout], name).toEqual([2, ""]);
    expect(JSON.parse(run.stderr), name).toEqual({ failure: "input", violations: [violation] });
  }
  const unknown = runWorker(driver, { command: "unknown", parameters: "{}" });
  expect([unknown.status, unknown.stdout, JSON.parse(unknown.stderr)]).toEqual([
    2,
    "",
    { failure: "unknown-operation" },
  ]);
}
