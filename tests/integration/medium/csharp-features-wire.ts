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
