import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import { acceptedInputs, begin, call, provider, type RunningCall } from "./rust/drivers.js";
import { build, cargoVersion, dispose, type Native } from "./rust/native.js";
import {
  closedOrigin,
  field,
  header,
  peer,
  received,
  respond,
  stopChildren,
} from "./rust/protocol.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 1_800_000 });
const native = test.skipIf(cargoVersion === undefined);
let built: Native;

beforeAll(async () => {
  if (cargoVersion !== undefined) built = await build("sample");
});
afterAll(async () => {
  await stopChildren();
  await dispose(built);
});

const envelope =
  '{"requestId":"00000000-0000-0000-0000-000000000001","recordId":"00000000-0000-0000-0000-000000000002","correlationId":"00000000-0000-0000-0000-000000000003","label":"😀😀😀","count":3,"amount":"9007199254740993123456789.123456789012345678900","occurredAt":"0000-02-29T12:34:56.1234567890123456789+05:45","nullableText":null,"items":[{"kind":"text","text":"😀"}]}';
const parameters = `{"input":${envelope}}`;
const json = { "Content-Type": "application/json" };

/** Call over a native peer answering the given bytes */
const outcome = async (
  response: Buffer,
  operation = "submit",
  input = parameters,
): Promise<Record<string, unknown>> =>
  call(built, {
    binding: "http",
    origin: (await peer(built.base, response)).origin,
    operation,
    parameters: input,
  });

native("applies defaults only during direct provider acceptance", () => {
  const direct = (extra: string): Record<string, unknown> =>
    call(built, {
      binding: "direct",
      operation: "submit",
      parameters: `{"input":${envelope}${extra}}`,
      reply: { outcome: "Completed" },
    });
  expect(direct("")).toMatchObject({ kind: "success", outcome: "Completed" });
  expect(direct(',"limit":null')).toMatchObject({ kind: "invalidInput" });
  expect(direct(',"limit":0')).toMatchObject({ kind: "invalidInput" });
});

native("never fills a default in the client request", async () => {
  const observed = await peer(built.base, respond(204, {}));
  expect(
    call(built, { binding: "http", origin: observed.origin, operation: "submit", parameters }),
  ).toMatchObject({ kind: "success", outcome: "Completed" });
  const request = await received(observed);
  expect(request.head[0]).toBe("POST /submit HTTP/1.1");
  expect(header(request.head, "content-type")).toBe("application/json");
  expect(JSON.parse(request.body.toString("utf8"))).toEqual({ input: JSON.parse(envelope) });
});

native("exposes the same default-applied handler input over every connection", async () => {
  const expected = { operation: "submit", accepted: { input: JSON.parse(envelope), limit: 3 } };
  const line = (binding: string, extra = ""): string =>
    `{"binding":"${binding}","operation":"submit","parameters":${JSON.stringify(`{"input":${envelope}${extra}}`)},"reply":{"outcome":"Completed"}}`;
  for (const binding of ["direct", "ipc"])
    expect(
      acceptedInputs(built, line(binding)).map((text) => JSON.parse(text) as unknown),
    ).toContainEqual(expected);
  const server = await provider(built, '{"submit":{"outcome":"Completed"}}');
  call(built, { binding: "http", origin: server.origin, operation: "submit", parameters });
  expect(
    await server.stderr.find((entry) => field(entry.json, "accepted") !== undefined),
  ).toMatchObject({ json: expected });
  expect(
    acceptedInputs(built, line("direct", ',"limit":2')).map((text) => JSON.parse(text) as unknown),
  ).toContainEqual({ operation: "submit", accepted: { input: JSON.parse(envelope), limit: 2 } });
});

const completed = { outcome: "Completed" };
/** Reply that the peer never gives, so only a host cancellation or deadline ends the call */
const held = { ...completed, hold: true };

/** Driver line of a submit over the named connection */
const submit = (
  binding: string,
  extra: Record<string, unknown> = {},
  reply: Record<string, unknown> = completed,
): Record<string, unknown> => ({ binding, operation: "submit", parameters, reply, ...extra });

/** Host cancellation ordered by an observed event instead of a delay
 * @param running - Call in flight
 * @param holding - Observation that the peer holds the request without answering
 * @returns Classification of the cancelled call
 */
async function cancelWhenHeld(
  running: RunningCall,
  holding: Promise<unknown>,
): Promise<Record<string, unknown>> {
  await holding;
  running.cancel();
  return running.result();
}

native("keeps a completed IPC result when cancellation is only observed afterwards", () => {
  expect(call(built, submit("ipc", { cancelAfterResult: true }))).toMatchObject({
    kind: "success",
    outcome: "Completed",
  });
});

native(
  "ends an IPC call cancelled before it starts or while it runs with a cancelled failure",
  async () => {
    expect(call(built, submit("ipc", { cancelBefore: true }))).toMatchObject({
      kind: "cancelled",
    });
    const running = begin(built, submit("ipc", {}, held));
    const holding = running.stderr.find((line) => field(line.json, "operation") === "submit");
    expect(await cancelWhenHeld(running, holding)).toMatchObject({ kind: "cancelled" });
  },
);

native(
  "reports the host deadline of an IPC call as a deadline failure owned by the host transport",
  () => {
    expect(call(built, submit("ipc", { deadlineMs: 10 }, held))).toMatchObject({
      kind: "deadlineExceeded",
    });
  },
);

native(
  "ends a direct call cancelled before it starts or while the handler runs with a cancelled failure",
  async () => {
    expect(call(built, submit("direct", { cancelBefore: true }))).toMatchObject({
      kind: "cancelled",
    });
    const running = begin(built, submit("direct", {}, held));
    const holding = running.stderr.find((line) => field(line.json, "operation") === "submit");
    expect(await cancelWhenHeld(running, holding)).toMatchObject({ kind: "cancelled" });
  },
);

native("keeps a completed HTTP result when cancellation is only observed afterwards", async () => {
  const answered = await peer(built.base, respond(204, {}));
  expect(
    call(built, submit("http", { origin: answered.origin, cancelAfterResult: true })),
  ).toMatchObject({ kind: "success", outcome: "Completed" });
});

native(
  "forwards cancellation to the bundled HTTP transport and leaves deadlines to the host",
  async () => {
    const silent = await peer(built.base, respond(204, {}), true);
    const running = begin(built, submit("http", { origin: silent.origin }));
    expect(await cancelWhenHeld(running, received(silent))).toMatchObject({ kind: "cancelled" });
    expect(call(built, submit("http", { origin: silent.origin, deadlineMs: 100 }))).toMatchObject({
      kind: "deadlineExceeded",
    });
  },
);

native("never opens a connection for a call cancelled before it starts", async () => {
  const untouched = await peer(built.base, respond(204, {}));
  expect(
    call(built, submit("http", { origin: untouched.origin, cancelBefore: true })),
  ).toMatchObject({ kind: "cancelled" });
  expect(call(built, submit("http", { origin: untouched.origin }))).toMatchObject({
    kind: "success",
    outcome: "Completed",
  });
  await received(untouched);
  expect(
    untouched.stdout.lines.filter((line) => field(line.json, "connection") !== undefined),
  ).toHaveLength(1);
});

native("selects a result by status and media type before decoding the body", async () => {
  expect(
    await outcome(
      respond(202, { "Content-Type": "Application/JSON; charset=utf-8" }, '{"value":"queued"}'),
    ),
  ).toMatchObject({ kind: "success", outcome: "Queued" });
  expect(await outcome(respond(201, json, '{"value":"created"}'))).toMatchObject({
    kind: "success",
    outcome: "Created",
  });
  expect(await outcome(respond(204, {}))).toMatchObject({
    kind: "success",
    outcome: "Completed",
    void: true,
  });
  expect(
    await outcome(respond(400, json, '{"code":"invalid","message":"declared"}')),
  ).toMatchObject({ kind: "rejected", outcome: "Rejected" });
});

native("treats every response that matches no declared result as a contract defect", async () => {
  for (const defect of [
    respond(200, json, '{"value":"looks valid"}'),
    respond(201, { "Content-Type": "text/plain" }, '{"value":"x"}'),
    respond(201, {}, '{"value":"x"}'),
    respond(201, json, "null"),
    respond(201, json, "{}"),
    respond(201, json, "not json"),
    respond(202, json, '{"value":7}'),
    respond(400, json, '{"code":"other","message":"x"}'),
    respond(404, json, '{"value":"x"}'),
  ])
    expect(await outcome(defect)).toMatchObject({ kind: "defect" });
});

native(
  "classifies a relay status that matches no declared body as a communication failure",
  async () => {
    for (const status of [502, 503, 504])
      expect(
        await outcome(respond(status, { "Content-Type": "text/html" }, "<proxy-error>")),
      ).toMatchObject({ kind: "communication" });
    expect(
      await outcome(
        respond(503, json, '{"code":"invalid","message":"not declared for this status"}'),
      ),
    ).toMatchObject({ kind: "communication" });
  },
);

native(
  "classifies an interrupted body and a refused connection as communication failures",
  async () => {
    expect(await outcome(respond(201, json, '{"value":', 200))).toMatchObject({
      kind: "communication",
    });
    expect(
      call(built, {
        binding: "http",
        origin: await closedOrigin(),
        operation: "submit",
        parameters,
      }),
    ).toMatchObject({ kind: "communication" });
  },
);

native("distinguishes an empty binary body from a JSON body and a declared rejection", async () => {
  expect(
    await outcome(respond(200, { "Content-Type": "application/octet-stream" }), "download", "{}"),
  ).toMatchObject({ kind: "success", outcome: "Downloaded", body: "" });
  expect(await outcome(respond(200, json, "[]"), "download", "{}")).toMatchObject({
    kind: "defect",
  });
  expect(
    await outcome(respond(404, json, '{"code":"invalid","message":"missing"}'), "download", "{}"),
  ).toMatchObject({ kind: "rejected", outcome: "Rejected" });
});
