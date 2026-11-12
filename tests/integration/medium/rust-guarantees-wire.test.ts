import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import { call, decode, drive, ipcLines, provider } from "./rust/drivers.js";
import { build, cargoVersion, dispose, type Native } from "./rust/native.js";
import {
  closedOrigin,
  field,
  peer,
  received,
  header,
  respond,
  stopChildren,
} from "./rust/protocol.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 1_800_000 });
const native = test.skipIf(cargoVersion === undefined);
let built: Native;

beforeAll(async () => {
  if (cargoVersion !== undefined) built = await build("guarantees");
});
afterAll(async () => {
  await stopChildren();
  await dispose(built);
});

native("returns an unknown IPC command to the host as a typed failure", () => {
  const [unknown] = ipcLines(built, "{}", ['{"command":"nonexistent","parameters":{}}']);
  expect(unknown).toEqual({ failure: "unknownOperation" });
});

native("returns invalid IPC parameters to the host as a typed failure with positions", () => {
  const [invalid] = ipcLines(built, "{}", ['{"command":"grow","parameters":{"tree":5}}']);
  expect(invalid).toMatchObject({
    failure: "invalidInput",
    violations: [{ path: "/tree", rule: "type" }],
  });
});

native(
  "returns an unpublished HTTP route to the host as a typed failure instead of answering it",
  async () => {
    const server = await provider(built, "{}");
    const response = await fetch(`${server.origin}/nowhere`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ failure: "unknownOperation" });
  },
);

native(
  "returns a header value without a wire form as a communication failure before any connection",
  async () => {
    const quiet = await peer(built.base, respond(204, {}));
    const result = call(built, {
      binding: "http",
      origin: quiet.origin,
      operation: "note",
      parameters: '{"text":"bad\\nvalue"}',
    });
    expect(result).toEqual({ kind: "communication" });
    const sent = call(built, {
      binding: "http",
      origin: quiet.origin,
      operation: "note",
      parameters: '{"text":"fine value"}',
    });
    expect(sent).toMatchObject({ kind: "success", outcome: "Noted" });
    await received(quiet);
    expect(
      quiet.stdout.lines.filter((line) => field(line.json, "connection") !== undefined),
    ).toHaveLength(1);
  },
);

native("sends a header value that has a wire form unchanged", async () => {
  const observed = await peer(built.base, respond(204, {}));
  const result = call(built, {
    binding: "http",
    origin: observed.origin,
    operation: "note",
    parameters: '{"text":"fine value"}',
  });
  expect(result).toMatchObject({ kind: "success", outcome: "Noted", void: true });
  expect(header((await received(observed)).head, "x-note")).toBe("fine value");
});

native(
  "retains the source spelling of numeric scalars and rejects what their storage cannot hold",
  () => {
    const exact = '{"whole":9007199254740993,"ratio":1.0E+2}';
    const observation = decode(built, "Exact", exact);
    expect(observation.accepted).toBe(true);
    expect(String(observation.encoded)).toContain('"whole":9007199254740993');
    expect(String(observation.encoded)).toContain('"ratio":1.0E+2');
    expect(decode(built, "Exact", '{"whole":1.5,"ratio":1}').violations).toEqual([
      { path: "/whole", rule: "type" },
    ]);
    expect(decode(built, "Exact", '{"whole":9223372036854775808,"ratio":1}').violations).toEqual([
      { path: "/whole", rule: "maximum" },
    ]);
    expect(decode(built, "Exact", '{"whole":1,"ratio":1e999}').violations).toEqual([
      { path: "/ratio", rule: "maximum" },
    ]);
  },
);

native(
  "accepts a binary64 whole number beyond the safe-integer range in both construction and decoding",
  () => {
    const observation = decode(built, "Exact", '{"whole":1,"ratio":1e300}');
    expect(observation.accepted).toBe(true);
    expect(String(observation.encoded)).toContain('"ratio":1e300');
  },
);

native("reports unknown members of a defaulted nested object with their positions", () => {
  const observation = decode(
    built,
    "Settings",
    '{"items":[{"extra":1}],"choice":{"kind":"anonymous"}}',
  );
  expect(observation.accepted).toBe(true);
  expect(observation.diagnostics).toEqual([{ path: "/items/0", key: "extra" }]);
});

native("refuses an origin that cannot be reached with a communication failure", async () => {
  const origin = await closedOrigin();
  expect(
    call(built, { binding: "http", origin, operation: "note", parameters: '{"text":"x"}' }),
  ).toEqual({ kind: "communication" });
  expect(
    drive(
      built,
      '{"binding":"direct","operation":"fetch","parameters":"{}","reply":{"outcome":"Found","body":""}}',
    ).stdout,
  ).toContain('"kind":"success"');
});
