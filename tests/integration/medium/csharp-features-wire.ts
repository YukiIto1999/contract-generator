import { expect } from "vite-plus/test";
import { httpResponse, parseRawRequest, type PeerPool } from "./csharp-peers.js";
import { runDriver } from "./csharp-process.js";

/** Path and header values of one archive call */
interface Values {
  readonly tenant: string;
  readonly item: string;
  readonly token: string;
}

/** Path value pairs that no single URL segment carries unchanged and that stay on the configured host when sent */
const sameHostPaths: readonly (readonly [string, string])[] = [
  [".", "x"],
  ["x", ".."],
  ["..", ".."],
  ["acme", ""],
];

/** Path value pairs whose leading empty value would make the second value the host of the request */
const otherHostPaths: readonly (readonly [string, string])[] = [
  ["", "attacker.invalid"],
  ["", ""],
];

/** Header texts with a control character other than horizontal tab, each able to frame a header or a request */
const framingTokens: readonly string[] = [
  "a\r\nInjected: 1",
  "a\nb",
  "a\rb",
  "a\u0000b",
  "a\u007fb",
];

/** Complete response of the archive operation */
const archived = httpResponse(200, { "Content-Type": "application/json" }, '{"value":"archived"}');

/** Archive call with an ordinary header value
 * @param pairs - Tenant and item values
 * @returns Calls with a fixed header value
 */
function pathCalls(pairs: readonly (readonly [string, string])[]): readonly Values[] {
  return pairs.map(([tenant, item]) => ({ tenant, item, token: "t" }));
}

/** Archive calls with an ordinary path and the given header values
 * @param tokens - Header texts
 * @returns Calls with fixed path values
 */
function headerCalls(tokens: readonly string[]): readonly Values[] {
  return tokens.map((token) => ({ tenant: "acme", item: "x", token }));
}

/** Ordinary path and header values on the request of the generated client
 * @param driver - Built FeaturesDriver.dll path
 * @param peers - Pool that owns the raw peers of the suite
 */
export async function expectOrdinaryValuesOnTheConfiguredOrigin(
  driver: string,
  peers: PeerPool,
): Promise<void> {
  const ordinary: Values = { tenant: "acme", item: "a/b c.d", token: "x\ty" };
  const [looped] = await runDriver(driver, [{ operation: "archive", ...ordinary }]);
  const { request } = looped!.wire as {
    request: { method: string; origin: string; target: string; token: string };
  };
  expect(looped).toMatchObject({ exit: "succeeded", case: "Archived", value: "archived" });
  expect([request.method, request.origin, request.target, request.token]).toEqual([
    "GET",
    "http://loopback.invalid",
    "/acme/a%2Fb%20c.d/archive",
    "x\ty",
  ]);
  expect(looped!.handlerSaw).toEqual(ordinary);
  const peer = await peers.start(archived);
  const [observed] = await runDriver(driver, [
    { operation: "archive", ...ordinary, url: peer.origin },
  ]);
  expect(observed).toMatchObject({ exit: "succeeded", case: "Archived", value: "archived" });
  const sent = parseRawRequest(peer.requests[0]!);
  expect([sent.line, sent.headers.get("x-token"), sent.headers.get("host")]).toEqual([
    "GET /acme/a%2Fb%20c.d/archive HTTP/1.1",
    "x\ty",
    new URL(peer.origin).host,
  ]);
}

/** Empty and dot path values and framing header values that never reach a transport or a socket
 * @param driver - Built FeaturesDriver.dll path
 * @param peers - Pool that owns the raw peers of the suite
 */
export async function expectUnsafeValuesNeverSent(driver: string, peers: PeerPool): Promise<void> {
  const looped = [
    ...pathCalls([...sameHostPaths, ...otherHostPaths]),
    ...headerCalls(framingTokens),
  ];
  const observations = await runDriver(
    driver,
    looped.map((values) => ({ operation: "archive", ...values })),
  );
  observations.forEach((observation, index) => {
    const name = JSON.stringify(looped[index]);
    expect(observation.exit, name).toBe("transport");
    expect(observation.wire, name).toEqual({});
  });
  const peer = await peers.start(archived);
  const socketed = [...pathCalls(sameHostPaths), ...headerCalls(framingTokens)];
  const real = await runDriver(
    driver,
    socketed.map((values) => ({ operation: "archive", ...values, url: peer.origin })),
  );
  real.forEach((observation, index) =>
    expect(observation.exit, JSON.stringify(socketed[index])).toBe("transport"),
  );
  expect(peer.requests).toHaveLength(0);
}

/** Redirect statuses that a native HTTP client follows by default */
const followedStatuses = [301, 302, 303, 307, 308] as const;

/** Upload calls of the raw bytes operation, whose request carries a body
 * @param origins - Service origins, one call each
 * @returns Calls against the origins
 */
function uploadCalls(origins: readonly string[]): readonly Record<string, unknown>[] {
  return origins.map((url) => ({ operation: "upload", bytes: "AP+A", url }));
}

/** A redirect that would carry the request to another origin never reaches that origin
 * @param driver - Built FeaturesDriver.dll path
 * @param peers - Pool that owns the raw peers of the suite
 */
export async function expectRedirectsNeverReachAnotherOrigin(
  driver: string,
  peers: PeerPool,
): Promise<void> {
  const target = await peers.start(
    httpResponse(200, { "Content-Type": "application/json" }, '{"value":"stored"}'),
  );
  const sources = await Promise.all(
    followedStatuses.map((status) =>
      peers.start(httpResponse(status, { Location: `${target.origin}leak` })),
    ),
  );
  const observations = await runDriver(driver, uploadCalls(sources.map((source) => source.origin)));
  expect(target.requests).toHaveLength(0);
  observations.forEach((observation, index) => {
    const name = `status ${followedStatuses[index]}`;
    expect(sources[index]!.requests, name).toHaveLength(1);
    expect(observation, name).toMatchObject({
      exit: "defected",
      defect: "InvalidOperationException",
    });
  });
}

/** A redirect to the same origin is not followed and is an undeclared response
 * @param driver - Built FeaturesDriver.dll path
 * @param peers - Pool that owns the raw peers of the suite
 */
export async function expectSameOriginRedirectNotFollowed(
  driver: string,
  peers: PeerPool,
): Promise<void> {
  const peer = await peers.start(httpResponse(307, { Location: "/elsewhere" }));
  const [observation] = await runDriver(driver, uploadCalls([peer.origin]));
  expect(peer.requests).toHaveLength(1);
  expect(observation).toMatchObject({ exit: "defected", defect: "InvalidOperationException" });
}
