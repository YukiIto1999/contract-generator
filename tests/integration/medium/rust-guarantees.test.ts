import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import { acceptedInputs, call, decode, provider } from "./rust/drivers.js";
import { build, cargoVersion, dispose, type Native } from "./rust/native.js";
import { field, peer, received, respond, stopChildren } from "./rust/protocol.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 1_800_000 });
const native = test.skipIf(cargoVersion === undefined);
const json = { "Content-Type": "application/json" };
let built: Native;

beforeAll(async () => {
  if (cargoVersion !== undefined) built = await build("guarantees");
});
afterAll(async () => {
  await stopChildren();
  await dispose(built);
});

/** Call line of the configure operation with every default omitted */
const configure = (binding: string, settings: string, extra = ""): string =>
  `{"binding":"${binding}","operation":"configure","parameters":${JSON.stringify(`{"settings":${settings}${extra}}`)},"reply":{"outcome":"Done","body":{"value":"ok"}}}`;
const bare = '{"items":[{},{"label":"given"}],"choice":{"kind":"named"}}';
/** Handler input every provider default must have produced, from the contract's declared defaults */
const filled = {
  settings: {
    retries: 5,
    items: [{ label: "unnamed" }, { label: "given" }],
    choice: { kind: "named", name: "anon" },
  },
  count: "7",
  span: "P2W",
  blob: "AQL/",
  flag: "true",
};
const accepted = (lines: string[]): unknown =>
  lines
    .map((line) => JSON.parse(line) as unknown)
    .find((line) => field(line, "operation") === "configure");

native("fills provider defaults at every depth for a direct call", () => {
  expect(accepted(acceptedInputs(built, configure("direct", bare)))).toEqual({
    operation: "configure",
    accepted: filled,
  });
});

native("fills provider defaults at every depth over the injected IPC connection", () => {
  expect(accepted(acceptedInputs(built, configure("ipc", bare)))).toEqual({
    operation: "configure",
    accepted: filled,
  });
});

native("fills provider defaults at every depth over real HTTP", async () => {
  const server = await provider(built, '{"configure":{"outcome":"Done","body":{"value":"ok"}}}');
  const request = JSON.stringify({
    binding: "http",
    origin: server.origin,
    operation: "configure",
    parameters: `{"settings":${bare}}`,
  });
  expect(call(built, JSON.parse(request) as Record<string, unknown>)).toMatchObject({
    kind: "success",
    outcome: "Done",
  });
  expect(
    await server.stderr.find((line) => field(line.json, "accepted") !== undefined),
  ).toMatchObject({ json: { accepted: filled } });
});

native("keeps explicit values and never fills a default in the client", async () => {
  const explicit = '{"retries":1,"items":[{"label":"x"}],"choice":{"kind":"anonymous"}}';
  const lines = acceptedInputs(built, configure("direct", explicit, ',"count":"9"'));
  expect(accepted(lines)).toMatchObject({
    accepted: {
      settings: { retries: 1, items: [{ label: "x" }], choice: { kind: "anonymous" } },
      count: "9",
    },
  });
  const observed = await peer(built.base, respond(200, json, '{"value":"ok"}'));
  call(built, {
    binding: "http",
    origin: observed.origin,
    operation: "configure",
    parameters: `{"settings":${bare}}`,
  });
  const sent = JSON.parse((await received(observed)).body.toString("utf8")) as unknown;
  expect(sent).toEqual({ settings: JSON.parse(bare) });
});

native(
  "serves bytes under a JSON media type as a JSON string in the binding encoding",
  async () => {
    const server = await provider(built, '{"fetch":{"outcome":"Found","body":"AP+A"}}');
    const response = await fetch(`${server.origin}/fetch`);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.text()).toBe('"AP+A"');
  },
);

native(
  "decodes bytes under a JSON media type from a JSON string and rejects raw octets",
  async () => {
    const request = (origin: string): Record<string, unknown> => ({
      binding: "http",
      origin,
      operation: "fetch",
      parameters: "{}",
    });
    const text = await peer(built.base, respond(200, json, '"AP+A"'));
    expect(call(built, request(text.origin))).toMatchObject({
      kind: "success",
      outcome: "Found",
      body: "AP+A",
    });
    const raw = await peer(built.base, respond(200, json, Buffer.from([0, 255, 128])));
    expect(call(built, request(raw.origin))).toMatchObject({ kind: "defect" });
  },
);

/** Outcome of the probe operation against a peer answering the given bytes */
const probe = async (response: Buffer): Promise<Record<string, unknown>> =>
  call(built, {
    binding: "http",
    origin: (await peer(built.base, response)).origin,
    operation: "probe",
    parameters: "{}",
  });

native(
  "selects a JSON result over a bodyless result that shares the status and sorts first",
  async () => {
    expect(await probe(respond(200, json, '{"id":4}'))).toMatchObject({
      kind: "success",
      outcome: "Present",
      body: { id: 4 },
    });
  },
);

native(
  "selects the bodyless result only for a response without body and Content-Type",
  async () => {
    expect(await probe(respond(200, {}))).toMatchObject({
      kind: "success",
      outcome: "Absent",
      void: true,
    });
  },
);

native(
  "never matches a bodyless result to a response that carries a body or a Content-Type",
  async () => {
    expect(await probe(respond(200, {}, "x"))).toMatchObject({ kind: "defect" });
    expect(await probe(respond(200, json))).toMatchObject({ kind: "defect" });
    expect(await probe(respond(200, { "Content-Type": "text/plain" }))).toMatchObject({
      kind: "defect",
    });
  },
);

const tree =
  '{"label":"root","child":{"label":"a","children":[]},"children":[{"label":"b","child":null,"children":[]}]}';
const expression =
  '{"kind":"add","left":{"kind":"num","value":1},"right":{"kind":"add","left":{"kind":"num","value":2},"right":{"kind":"num","value":3}}}';

native("round-trips a type that recurses through an optional nullable member and an array", () => {
  const observation = decode(built, "Tree", tree);
  expect(observation.accepted).toBe(true);
  expect(JSON.parse(String(observation.encoded))).toEqual(JSON.parse(tree));
  expect(decode(built, "Tree", '{"label":"x","child":5,"children":[]}').violations).toEqual([
    { path: "/child", rule: "type" },
  ]);
});

native("round-trips a type that recurses through a union case", () => {
  const observation = decode(built, "Expr", expression);
  expect(observation.accepted).toBe(true);
  expect(JSON.parse(String(observation.encoded))).toEqual(JSON.parse(expression));
  expect(
    decode(built, "Expr", '{"kind":"add","left":{"kind":"num","value":1},"right":{"kind":"mul"}}')
      .violations,
  ).toEqual([{ path: "/right/kind", rule: "variant" }]);
});

native("carries a recursive value over the injected IPC connection", () => {
  const body = JSON.parse(tree) as unknown;
  const parameters = JSON.stringify(`{"tree":${tree}}`);
  const result = call(built, {
    binding: "ipc",
    operation: "grow",
    parameters: JSON.parse(parameters) as string,
    reply: { outcome: "Grown", body },
  });
  expect(result).toMatchObject({ kind: "success", outcome: "Grown", body });
});
