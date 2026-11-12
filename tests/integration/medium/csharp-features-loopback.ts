import { expect } from "vite-plus/test";
import { essence, runDriver } from "./csharp-process.js";

/** Recorded generated-client request and generated-provider response of one in-memory loopback exchange */
interface Wire {
  /** Request as the generated client sent it */
  readonly request: {
    readonly method: string;
    readonly target: string;
    readonly token?: string;
    readonly contentType: string | null;
    readonly bodyBase64: string;
  };
  /** Response as the generated provider produced it */
  readonly response: {
    readonly status: number;
    readonly xcase?: string;
    readonly contentType: string | null;
    readonly bodyBase64: string;
  };
}

/** UTF-8 text of a base64 observation
 * @param encoded - Base64 bytes
 * @returns Decoded text
 */
export function utf8(encoded: unknown): string {
  return Buffer.from(String(encoded), "base64").toString("utf8");
}

/** Wire record of an observation
 * @param observation - Driver observation of a loopback operation
 * @returns Recorded exchange
 */
function wireOf(observation: Record<string, unknown> | undefined): Wire {
  return observation!.wire as Wire;
}

/** One loopback choose scenario: name, expected observation, status, selector and body */
type ChooseScenario = readonly [
  string,
  Record<string, unknown>,
  number,
  string | undefined,
  string,
];

/** Same-status results selected by header and a declared 503 rejection selected by body
 * @param driver - Built FeaturesDriver.dll path
 */
export async function expectSameStatusSelection(driver: string): Promise<void> {
  const scenarios: readonly ChooseScenario[] = [
    ["first", { exit: "succeeded", case: "First", value: "one" }, 201, "first", '{"value":"one"}'],
    [
      "second",
      { exit: "succeeded", case: "Second", value: "two" },
      201,
      "second",
      '{"value":"two"}',
    ],
    ["nil", { exit: "succeeded", case: "Nil", value: null }, 202, undefined, "null"],
    ["done", { exit: "succeeded", case: "Done" }, 204, undefined, ""],
    ["refused", { exit: "declared", reason: "blocked" }, 503, undefined, '{"reason":"blocked"}'],
  ];
  const observations = await runDriver(
    driver,
    scenarios.map(([scenario]) => ({ operation: "choose", scenario })),
  );
  scenarios.forEach(([scenario, expected, status, selector, body], index) => {
    const { request, response } = wireOf(observations[index]);
    expect(observations[index], scenario).toMatchObject(expected);
    expect(
      [request.method, request.target, response.status, response.xcase, utf8(response.bodyBase64)],
      scenario,
    ).toEqual(["GET", "/choose", status, selector, body]);
    expect(essence(response.contentType ?? undefined), scenario).toBe(
      status === 204 ? "" : "application/json",
    );
  });
}

/** Path, query, header and body placement with the default left to the provider
 * @param driver - Built FeaturesDriver.dll path
 */
export async function expectParameterMapping(driver: string): Promise<void> {
  const [explicit, defaulted, nullBody] = await runDriver(driver, [
    { operation: "route", pathId: "a/b c", token: "tok", input: { value: "v" } },
    { operation: "route", pathId: "p", token: "tok", search: "x y&z=1" },
    { operation: "route", pathId: "p", token: "tok", input: null },
  ]);
  const sent = [explicit, defaulted, nullBody].map(wireOf);
  expect(
    sent.map((wire) => [wire.request.method, wire.request.target, wire.request.token]),
  ).toEqual([
    ["POST", "/route/a%2Fb%20c", "tok"],
    ["POST", "/route/p?q=x%20y%26z%3D1", "tok"],
    ["POST", "/route/p", "tok"],
  ]);
  expect([
    utf8(sent[0]!.request.bodyBase64),
    essence(sent[0]!.request.contentType ?? undefined),
  ]).toEqual(['{"value":"v"}', "application/json"]);
  expect([utf8(sent[1]!.request.bodyBase64), sent[1]!.request.contentType]).toEqual(["", null]);
  expect(utf8(sent[2]!.request.bodyBase64)).toBe("null");
  expect(explicit!.handlerSaw).toEqual({
    pathId: "a/b c",
    token: "tok",
    search: "default",
    input: "v",
  });
  expect(defaulted!.handlerSaw).toEqual({
    pathId: "p",
    token: "tok",
    search: "x y&z=1",
    input: "absent",
  });
  expect(nullBody!.handlerSaw).toEqual({
    pathId: "p",
    token: "tok",
    search: "default",
    input: null,
  });
  for (const observation of [explicit, defaulted, nullBody])
    expect(observation).toMatchObject({ exit: "succeeded", case: "Matched", value: "matched" });
}

/** Bytes carried unchanged in both directions with an empty body distinct from an absent one
 * @param driver - Built FeaturesDriver.dll path
 */
export async function expectBytesRoundTrip(driver: string): Promise<void> {
  const [bytes, empty, image] = await runDriver(driver, [
    { operation: "upload", bytes: "AP8=" },
    { operation: "upload", bytes: "" },
    { operation: "image" },
  ]);
  const sent = [bytes, empty].map(wireOf);
  expect(
    sent.map((wire) => [wire.request.bodyBase64, essence(wire.request.contentType ?? undefined)]),
  ).toEqual([
    ["AP8=", "application/octet-stream"],
    ["", "application/octet-stream"],
  ]);
  expect([bytes!.handlerSaw, empty!.handlerSaw]).toEqual([{ bytes: "AP8=" }, { bytes: "" }]);
  const served = wireOf(image);
  expect([
    image!.bytes,
    served.response.bodyBase64,
    essence(served.response.contentType ?? undefined),
  ]).toEqual(["iVBORw==", "iVBORw==", "image/png"]);
}
