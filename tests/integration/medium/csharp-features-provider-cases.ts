/** Driver request, expected observation pair with its name */
export type Scenario = readonly [
  name: string,
  request: Record<string, unknown>,
  expected: Record<string, unknown>,
];

/** Base64 of UTF-8 text
 * @param text - Request body text
 * @returns Base64 bytes
 */
function encode(text: string): string {
  return Buffer.from(text).toString("base64");
}

/** JSON request media type of a hand-written provider request */
const json = { contentType: "application/json" };
/** Binary request media type of a hand-written provider request */
const octet = { contentType: "application/octet-stream" };

/** Hand-written provider request that routes to the route operation
 * @param target - Request target
 * @param extra - Further request fields
 * @returns Driver request
 */
function route(target: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { operation: "provider", method: "POST", target, headers: { "X-Token": ["t"] }, ...extra };
}

/** Hand-written provider request with a method and target only
 * @param method - HTTP method
 * @param target - Request target
 * @param extra - Further request fields
 * @returns Driver request
 */
function plain(
  method: string,
  target: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { operation: "provider", method, target, ...extra };
}

/** Provider requests that path, query, header and JSON body placement must complete
 * @returns Scenarios for the route operation
 */
function routeScenarios(): readonly Scenario[] {
  const saw = (search: string, input: unknown, pathId = "a b"): Record<string, unknown> => ({
    exit: "responded",
    handlerSaw: { pathId, token: "t", search, input },
  });
  return [
    [
      "path and query are decoded and q overrides the default",
      route("/route/a%20b?q=x%20y", { ...json, body: encode('{"value":"v"}') }),
      { ...saw("x y", "v"), status: 200 },
    ],
    [
      "an absent q receives the default and an absent body is an absent input",
      route("/route/a%20b"),
      { ...saw("default", "absent"), status: 200 },
    ],
    [
      "a JSON null body is a present null input",
      route("/route/a", { ...json, body: encode("null") }),
      saw("default", null, "a"),
    ],
    [
      "a missing required header is a normal violation",
      plain("POST", "/route/a"),
      { exit: "input", violations: [{ path: "/token", rule: "required" }] },
    ],
    [
      "an empty body under a JSON media type is malformed JSON",
      route("/route/a", { ...json, body: "" }),
      { exit: "input", violations: [{ path: "", rule: "json" }] },
    ],
    [
      "a body under another media type is rejected",
      route("/route/a", { contentType: "text/plain", body: encode("{}") }),
      { exit: "input", violations: [{ path: "", rule: "type" }] },
    ],
  ];
}

/** Provider requests that raw byte bodies and unknown routes must complete
 * @returns Scenarios for the upload, image and routing behavior
 */
function binaryAndRoutingScenarios(): readonly Scenario[] {
  const upload = (extra: Record<string, unknown>): Record<string, unknown> =>
    plain("POST", "/upload", extra);
  return [
    [
      "an empty byte body is accepted",
      upload({ ...octet, body: "" }),
      { exit: "responded", status: 200, handlerSaw: { bytes: "" } },
    ],
    [
      "byte bodies pass unchanged",
      upload({ ...octet, body: Buffer.from([0, 255]).toString("base64") }),
      { exit: "responded", status: 200, handlerSaw: { bytes: "AP8=" } },
    ],
    [
      "an absent byte body is required",
      upload({}),
      { exit: "input", violations: [{ path: "/binary", rule: "required" }] },
    ],
    [
      "a byte body under a JSON media type is rejected",
      upload({ ...json, body: encode("[]") }),
      { exit: "input", violations: [{ path: "", rule: "type" }] },
    ],
    [
      "the image result carries its declared media type",
      plain("GET", "/image"),
      { exit: "responded", status: 200, contentType: "image/png", bodyBase64: "iVBORw==" },
    ],
    ["an undeclared route is unknown", plain("DELETE", "/nothing"), { exit: "unknown-operation" }],
    [
      "a declared route with another method is unknown",
      plain("GET", "/route/a"),
      { exit: "unknown-operation" },
    ],
  ];
}

/** Expected effective branch: every omitted defaulted member filled at every depth */
function effectiveBranch(): Record<string, unknown> {
  const leaf = (
    name: string,
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    name,
    blob: "AQL/",
    enabled: true,
    count: 7,
    span: "P2W",
    at: "2024-02-29T12:00:00Z",
    ...overrides,
  });
  return {
    leaf: leaf("a"),
    leaves: [leaf("b", { enabled: false, count: 9 })],
    shapes: [
      { kind: "solid", leaf: leaf("c") },
      { kind: "plain", note: "fallback" },
      { kind: "plain", note: "mine" },
    ],
  };
}

/** Branch wire value with every defaulted member omitted except where an explicit value must win
 * @param textual - Whether booleans and numbers use the HTTP string encoding
 * @returns Wire value
 */
function branchInput(textual: boolean): Record<string, unknown> {
  return {
    leaf: { name: "a" },
    leaves: [
      textual
        ? { name: "b", enabled: "false", count: "9" }
        : { name: "b", enabled: false, count: 9 },
    ],
    shapes: [
      { kind: "solid", leaf: { name: "c" } },
      { kind: "plain" },
      { kind: "plain", note: "mine" },
    ],
  };
}

/** Defaults that provider acceptance fills below the input, through every provider entry
 * @returns Scenarios for the defaults operation
 */
export function defaultScenarios(): readonly Scenario[] {
  const expected = { handlerSaw: effectiveBranch() };
  return [
    [
      "a direct call fills defaults in nested objects, array elements and union variants",
      { operation: "direct", payload: JSON.stringify({ branch: branchInput(true) }) },
      { exit: "succeeded", ...expected },
    ],
    [
      "an HTTP request fills the same defaults including bytes and string-encoded values",
      plain("POST", "/defaults", {
        ...json,
        body: encode(JSON.stringify({ branch: branchInput(true) })),
      }),
      { exit: "responded", status: 200, ...expected },
    ],
    [
      "an IPC command fills the same defaults",
      {
        operation: "providerIpc",
        command: "defaults",
        parameters: JSON.stringify({ branch: branchInput(false) }),
      },
      { exit: "responded", ...expected },
    ],
  ];
}

/** Body members that repeat a placed parameter
 * @returns Scenarios for the merge operation
 */
export function mergeScenarios(): readonly Scenario[] {
  const request = (body: string): Record<string, unknown> =>
    plain("POST", "/merge/p", { ...json, body: encode(body) });
  return [
    [
      "a body member named like the placed path parameter never overrides it",
      request('{"label":"x","id":"evil"}'),
      { exit: "responded", status: 200, handlerSaw: { id: "p", label: "x" } },
    ],
    [
      "a body without the repeated member behaves the same",
      request('{"label":"x"}'),
      { exit: "responded", status: 200, handlerSaw: { id: "p", label: "x" } },
    ],
  ];
}

/** Provider requests of the route, binary and routing groups
 * @returns Scenarios in report order
 */
export function providerScenarios(): readonly Scenario[] {
  return [
    ...routeScenarios(),
    ...binaryAndRoutingScenarios(),
    ...mergeScenarios(),
    ...defaultScenarios(),
  ];
}
