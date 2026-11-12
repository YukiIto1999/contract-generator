import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import { call, provider } from "./rust/drivers.js";
import { build, cargoVersion, dispose, type Native } from "./rust/native.js";
import { field, peer, respond, stopChildren } from "./rust/protocol.js";

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
const created =
  '{"submit":{"outcome":"Created","body":{"value":"receipt"}},"download":{"outcome":"Downloaded","body":""}}';

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

native(
  "round-trips a created result between the generated client and the real HTTP provider",
  async () => {
    const server = await provider(built, created);
    expect(
      call(built, { binding: "http", origin: server.origin, operation: "submit", parameters }),
    ).toMatchObject({ kind: "success", outcome: "Created", body: { value: "receipt" } });
  },
);

native(
  "round-trips success, void and rejection results through a separately spawned IPC provider",
  () => {
    const ipc = (reply: Record<string, unknown>): Record<string, unknown> =>
      call(built, { binding: "ipc", operation: "submit", parameters, reply });
    expect(ipc({ outcome: "Queued", body: { value: "queued" } })).toMatchObject({
      kind: "success",
      outcome: "Queued",
      body: { value: "queued" },
    });
    expect(ipc({ outcome: "Completed" })).toMatchObject({
      kind: "success",
      outcome: "Completed",
      void: true,
    });
    expect(
      ipc({ outcome: "Rejected", body: { code: "invalid", message: "normal rejection" } }),
    ).toMatchObject({ kind: "rejected", outcome: "Rejected" });
  },
);

native("round-trips void and declared rejection results over real HTTP", async () => {
  const completed = await provider(built, '{"submit":{"outcome":"Completed"}}');
  expect(
    call(built, { binding: "http", origin: completed.origin, operation: "submit", parameters }),
  ).toMatchObject({ kind: "success", outcome: "Completed", void: true });
  const rejected = await provider(
    built,
    '{"submit":{"outcome":"Rejected","body":{"code":"invalid","message":"declared"}},"download":{"outcome":"Rejected","body":{"code":"invalid","message":"absent"}}}',
  );
  expect(
    call(built, { binding: "http", origin: rejected.origin, operation: "submit", parameters }),
  ).toMatchObject({ kind: "rejected", body: { code: "invalid", message: "declared" } });
  expect(
    call(built, {
      binding: "http",
      origin: rejected.origin,
      operation: "download",
      parameters: "{}",
    }),
  ).toMatchObject({ kind: "rejected", body: { message: "absent" } });
});

native("answers with the declared status, media type and body", async () => {
  const server = await provider(built, created);
  const post = (body: string, type = "application/json") =>
    fetch(`${server.origin}/submit`, { method: "POST", headers: { "content-type": type }, body });
  const accepted = await post(parameters);
  expect(accepted.status).toBe(201);
  expect(accepted.headers.get("content-type")).toBe("application/json");
  expect(await accepted.json()).toEqual({ value: "receipt" });
});

native(
  "returns each invalid default-bearing value to the host as a typed failure without repairing it",
  async () => {
    const server = await provider(built, created);
    for (const [limit, rule] of [
      ["null", "null"],
      ["0", "minimum"],
      ["4", "maximum"],
      ['"3"', "type"],
    ] as const) {
      const refused = await fetch(`${server.origin}/submit`, {
        method: "POST",
        headers: json,
        body: `{"input":${envelope},"limit":${limit}}`,
      });
      expect(refused.status, `limit ${limit}`).toBe(400);
      expect(field(await refused.json(), "violations")).toEqual([{ path: "/limit", rule }]);
    }
  },
);

native(
  "returns a wrong media type and a malformed body to the host as typed failures",
  async () => {
    const server = await provider(built, created);
    const post = (body: string, type: string) =>
      fetch(`${server.origin}/submit`, { method: "POST", headers: { "content-type": type }, body });
    expect((await post(parameters, "text/plain")).status).toBe(400);
    expect((await post("not json", "application/json")).status).toBe(400);
  },
);

native("hands unknown members to the host as positions and keys without their values", async () => {
  const server = await provider(built, created);
  const unknown = await fetch(`${server.origin}/submit`, {
    method: "POST",
    headers: json,
    body: `{"input":${envelope},"extra":{"secret":"value"}}`,
  });
  expect(unknown.status).toBe(201);
  expect(
    await server.stderr.find((line) => field(line.json, "diagnostics") !== undefined),
  ).toMatchObject({ json: { diagnostics: [{ path: "", key: "extra" }] } });
  expect(server.stderr.lines.map((line) => line.raw).join("\n")).not.toContain("secret");
});

native("answers an empty binary result with its media type and no bytes", async () => {
  const server = await provider(built, created);
  const download = await fetch(`${server.origin}/download`);
  expect(download.status).toBe(200);
  expect(download.headers.get("content-type")).toBe("application/octet-stream");
  expect((await download.arrayBuffer()).byteLength).toBe(0);
  expect(
    call(built, {
      binding: "http",
      origin: server.origin,
      operation: "download",
      parameters: "{}",
    }),
  ).toMatchObject({ kind: "success", outcome: "Downloaded", body: "", void: false });
});

native(
  "returns an unpublished method on a published route to the host as a typed failure",
  async () => {
    const server = await provider(built, created);
    const wrong = await fetch(`${server.origin}/download`, { method: "POST", body: "x" });
    expect(wrong.status).toBe(404);
    expect(await wrong.json()).toEqual({ failure: "unknownOperation" });
  },
);

native("retains arbitrary non-UTF-8 binary bytes over a real HTTP response", async () => {
  const result = await outcome(
    respond(200, { "Content-Type": "application/octet-stream" }, Buffer.from([0, 255, 128])),
    "download",
    "{}",
  );
  expect(result).toMatchObject({
    kind: "success",
    outcome: "Downloaded",
    body: "AP+A",
    void: false,
  });
});
