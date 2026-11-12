import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import { acceptedInputs, call, drive, provider } from "./rust/drivers.js";
import { build, cargoVersion, dispose, type Native } from "./rust/native.js";
import { peer, respond, stopChildren } from "./rust/protocol.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 1_800_000 });
const native = test.skipIf(cargoVersion === undefined);
let built: Native;

beforeAll(async () => {
  if (cargoVersion !== undefined) built = await build("wide");
});
afterAll(async () => {
  await stopChildren();
  await dispose(built);
});

const row =
  '{"id":9007199254740993,"counter":18446744073709551615,"weight":1.5,"ratio":0.5,"day":"2024-02-29","time":"12:30:45.5","span":"P1Y2M3DT4H5M6.7S","stamp":"2024-02-29T12:30:45.123456789Z","flag":true,"mode":"fast","tags":["a","b"],"note":null,"fixed":7,"rate":12.50,"big":12345678901234567890}';
const json = { "Content-Type": "application/json" };
/** Outcome of a lookup, store or batch call against a peer answering the given bytes */
const outcome = async (
  response: Buffer,
  operation = "lookup",
  input = '{"key":"k"}',
): Promise<Record<string, unknown>> =>
  call(built, {
    binding: "http",
    origin: (await peer(built.base, response)).origin,
    operation,
    parameters: input,
  });
native("selects results by the exact value of a declared header", async () => {
  expect(await outcome(respond(200, { ...json, "X-SOURCE": "replica" }, row))).toMatchObject({
    kind: "success",
    outcome: "Replica",
  });
  expect(await outcome(respond(200, { ...json, "x-source": "primary" }, row))).toMatchObject({
    kind: "success",
    outcome: "Primary",
  });
  for (const headers of [
    json,
    { ...json, "x-source": "other" },
    { ...json, "x-source": "Primary" },
  ])
    expect(await outcome(respond(200, headers, row))).toMatchObject({ kind: "defect" });
});

native("classifies declared rejections and gateway statuses by their declared body", async () => {
  expect(await outcome(respond(404, json, '{"key":"k"}'))).toMatchObject({
    kind: "rejected",
    outcome: "Missing",
  });
  expect(await outcome(respond(503, json, '{"retryAfter":3}'))).toMatchObject({
    kind: "rejected",
    outcome: "Unavailable",
    body: { retryAfter: 3 },
  });
  expect(
    await outcome(respond(503, { "Content-Type": "text/html" }, "<proxy-error>")),
  ).toMatchObject({ kind: "communication" });
  expect(await outcome(respond(503, json, '{"retryAfter":"soon"}'))).toMatchObject({
    kind: "communication",
  });
  for (const status of [502, 504])
    expect(await outcome(respond(status, json, '{"retryAfter":3}'))).toMatchObject({
      kind: "communication",
    });
});

native(
  "treats a declared gateway rejection as a rejection and its mismatch as a communication failure",
  async () => {
    const batch = `{"rows":[${row}],"mode":"fast","note":null}`;
    expect(await outcome(respond(502, json, '{"retryAfter":1}'), "batch", batch)).toMatchObject({
      kind: "rejected",
      outcome: "Refused",
    });
    expect(await outcome(respond(503, json, '{"retryAfter":1}'), "batch", batch)).toMatchObject({
      kind: "communication",
    });
    expect(
      await outcome(respond(502, { "Content-Type": "text/plain" }, "bad gateway"), "batch", batch),
    ).toMatchObject({ kind: "communication" });
    expect(await outcome(respond(204, {}), "batch", batch)).toMatchObject({
      kind: "success",
      outcome: "Empty",
      void: true,
    });
    expect(
      await outcome(respond(200, json, '{"rows":[],"next":null}'), "batch", batch),
    ).toMatchObject({ kind: "defect" });
  },
);

native("classifies store results and treats a bodyless 200 as an undeclared response", async () => {
  const store = '{"key":"k","data":"AP+A"}';
  expect(await outcome(respond(409, json, '{"key":"k"}'), "store", store)).toMatchObject({
    kind: "rejected",
    outcome: "Conflict",
  });
  expect(await outcome(respond(200, {}), "store", store)).toMatchObject({ kind: "defect" });
});

/** Raw call command of a batch with the given extra member */
const batchCommand = (binding: string, extra: string): string =>
  `{"binding":"${binding}","operation":"batch","parameters":${JSON.stringify(`{"rows":[${row}],"mode":"fast","note":null${extra}}`)},"reply":{"outcome":"Empty"}}`;

native(
  "applies a provider default beyond the safe-integer range identically for direct and IPC calls",
  () => {
    for (const binding of ["direct", "ipc"]) {
      const fills = acceptedInputs(built, batchCommand(binding, "")).some(
        (line) =>
          line.includes('"cursor":9007199254740993') && line.includes('"id":9007199254740993'),
      );
      expect(fills, binding).toBe(true);
      const explicit = acceptedInputs(
        built,
        batchCommand(binding, ',"cursor":9007199254740994'),
      ).some((line) => line.includes('"cursor":9007199254740994'));
      expect(explicit, binding).toBe(true);
    }
  },
);

native(
  "applies the provider default over real HTTP and refuses null or out-of-range cursors",
  async () => {
    const server = await provider(built, '{"batch":{"outcome":"Empty"}}');
    call(built, {
      binding: "http",
      origin: server.origin,
      operation: "batch",
      parameters: `{"rows":[${row}],"mode":"fast","note":null}`,
    });
    expect(
      (await server.stderr.find((line) => line.raw.includes('"operation":"batch"'))).raw,
    ).toContain('"cursor":9007199254740993');
    for (const binding of ["direct", "ipc"])
      for (const [extra, rule] of [
        [',"cursor":null', "null"],
        [',"cursor":-1', "minimum"],
      ] as const)
        expect(JSON.parse(drive(built, batchCommand(binding, extra)).stdout)).toMatchObject({
          kind: "invalidInput",
          violations: [{ path: "/cursor", rule }],
        });
  },
);

native(
  "round-trips every operation through a separately spawned IPC provider with resolved result envelopes",
  () => {
    const parametersOf = (operation: string): string =>
      operation === "lookup"
        ? '{"key":"k"}'
        : operation === "store"
          ? '{"key":"k","data":"AP+A"}'
          : `{"rows":[${row}],"mode":"fast","note":null}`;
    const run = (operation: string, name: string, body?: string): Record<string, unknown> =>
      JSON.parse(
        drive(
          built,
          `{"binding":"ipc","operation":"${operation}","parameters":${JSON.stringify(parametersOf(operation))},"reply":{"outcome":"${name}"${body === undefined ? "" : `,"body":${body}`}}}`,
        ).stdout,
      ) as Record<string, unknown>;
    expect(run("lookup", "Primary", row)).toMatchObject({ kind: "success", outcome: "Primary" });
    expect(run("lookup", "Missing", '{"key":"k"}')).toMatchObject({
      kind: "rejected",
      outcome: "Missing",
    });
    expect(run("lookup", "Unavailable", '{"retryAfter":9}')).toMatchObject({
      kind: "rejected",
      outcome: "Unavailable",
      body: { retryAfter: 9 },
    });
    expect(run("store", "Stored")).toMatchObject({
      kind: "success",
      outcome: "Stored",
      void: true,
    });
    expect(run("store", "Conflict", '{"key":"k"}')).toMatchObject({
      kind: "rejected",
      outcome: "Conflict",
    });
    expect(run("batch", "Done", `{"rows":[${row}],"next":null}`)).toMatchObject({
      kind: "success",
      outcome: "Done",
    });
    expect(run("batch", "Empty")).toMatchObject({ kind: "success", outcome: "Empty", void: true });
    expect(run("batch", "Refused", '{"retryAfter":2}')).toMatchObject({
      kind: "rejected",
      outcome: "Refused",
    });
  },
);
