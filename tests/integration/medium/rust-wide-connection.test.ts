import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import { call, drive, provider } from "./rust/drivers.js";
import { build, dispose, type Native } from "./rust/native.js";
import { field, header, peer, received, respond, stopChildren } from "./rust/protocol.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 1_800_000 });
const native = test;
let built: Native;

beforeAll(async () => {
  built = await build("wide");
});
afterAll(async () => {
  await stopChildren();
  await dispose(built);
});

const row =
  '{"id":9007199254740993,"counter":18446744073709551615,"weight":1.5,"ratio":0.5,"day":"2024-02-29","time":"12:30:45.5","span":"P1Y2M3DT4H5M6.7S","stamp":"2024-02-29T12:30:45.123456789Z","flag":true,"mode":"fast","tags":["a","b"],"note":null,"fixed":7,"rate":12.50,"big":12345678901234567890}';
const json = { "Content-Type": "application/json" };
const replies = (outcome: string): string =>
  `{"lookup":{"outcome":"${outcome}","body":${row}},"store":{"outcome":"Stored"},"batch":{"outcome":"Done","body":{"rows":[${row}],"next":null}}}`;

native(
  "round-trips path, query and header placements over real HTTP with the exact numbers intact",
  async () => {
    const primary = await provider(built, replies("Primary"));
    const parameters = '{"key":"alpha","verbose":true,"limit":5,"traceId":"t-1"}';
    const first = drive(
      built,
      JSON.stringify({ binding: "http", origin: primary.origin, operation: "lookup", parameters }),
    );
    expect(JSON.parse(first.stdout)).toMatchObject({ kind: "success", outcome: "Primary" });
    expect(first.stdout).toContain('"id":9007199254740993');
    const seen = await primary.stderr.find((line) => field(line.json, "accepted") !== undefined);
    expect(seen.json).toEqual({
      operation: "lookup",
      accepted: { key: "alpha", verbose: true, limit: 5, traceId: "t-1" },
    });
  },
);

native(
  "answers with the declared status, media type and selector header of the chosen result",
  async () => {
    const primary = await provider(built, replies("Primary"));
    const replica = await provider(built, replies("Replica"));
    const raw = await fetch(`${primary.origin}/records/alpha?verbose=true&limit=5`, {
      headers: { "X-Trace-Id": "t-2" },
    });
    expect(raw.status).toBe(200);
    expect(raw.headers.get("x-source")).toBe("primary");
    expect(raw.headers.get("content-type")).toBe("application/json");
    expect((await fetch(`${replica.origin}/records/alpha`)).headers.get("x-source")).toBe(
      "replica",
    );
  },
);

native(
  "returns a malformed query parameter to the host as a typed failure with its position",
  async () => {
    const primary = await provider(built, replies("Primary"));
    const malformed = await fetch(`${primary.origin}/records/alpha?limit=abc`);
    expect(malformed.status).toBe(400);
    expect(field(await malformed.json(), "violations")).toEqual([{ path: "/limit", rule: "type" }]);
  },
);

native("returns an unpublished method or route to the host as a typed failure", async () => {
  const primary = await provider(built, replies("Primary"));
  for (const response of [
    await fetch(`${primary.origin}/records/alpha`, { method: "POST" }),
    await fetch(`${primary.origin}/records`),
  ]) {
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ failure: "unknownOperation" });
  }
});

native("receives a raw binary request body with its path placement intact", async () => {
  const primary = await provider(built, replies("Primary"));
  const stored = await fetch(`${primary.origin}/uploads/k`, {
    method: "PUT",
    headers: { "content-type": "application/octet-stream" },
    body: new Uint8Array([0, 255, 128]),
  });
  expect(stored.status).toBe(204);
  expect(stored.headers.get("content-type")).toBeNull();
  expect(await stored.text()).toBe("");
  expect(
    await primary.stderr.find((line) => field(line.json, "operation") === "store"),
  ).toMatchObject({ json: { accepted: { key: "k", data: "AP+A" } } });
});

native("rejects a raw binary request carrying another media type", async () => {
  const primary = await provider(built, replies("Primary"));
  const refused = await fetch(`${primary.origin}/uploads/k`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: "[]",
  });
  expect(refused.status).toBe(400);
});

native("requires every non-defaulted member of a JSON body", async () => {
  const primary = await provider(built, replies("Primary"));
  const refused = await fetch(`${primary.origin}/batch`, {
    method: "POST",
    headers: json,
    body: `{"rows":[${row}],"note":null}`,
  });
  expect(refused.status).toBe(400);
  expect(field(await refused.json(), "violations")).toEqual([{ path: "/mode", rule: "required" }]);
});

native(
  "sends percent-encoded path, query and header placements on the real HTTP request",
  async () => {
    const looked = await peer(built.base, respond(200, { ...json, "X-Source": "primary" }, row));
    call(built, {
      binding: "http",
      origin: looked.origin,
      operation: "lookup",
      parameters: '{"key":"a/b c","verbose":true,"limit":5,"traceId":"t-1"}',
    });
    const lookup = await received(looked);
    const url = new URL(lookup.head[0]?.split(" ")[1] ?? "", "http://peer");
    expect(url.pathname).toBe("/records/a%2Fb%20c");
    expect([...url.searchParams.keys()].sort()).toEqual(["limit", "verbose"]);
    expect(header(lookup.head, "x-trace-id")).toBe("t-1");
    expect(header(lookup.head, "content-type")).toBeUndefined();
    expect(lookup.body.length).toBe(0);
  },
);

native("omits unplaced optional parameters and sends a raw binary body unchanged", async () => {
  const omitted = await peer(built.base, respond(200, { ...json, "x-source": "replica" }, row));
  call(built, {
    binding: "http",
    origin: omitted.origin,
    operation: "lookup",
    parameters: '{"key":"k"}',
  });
  const bare = await received(omitted);
  expect(bare.head[0]).toBe("GET /records/k HTTP/1.1");
  expect(header(bare.head, "x-trace-id")).toBeUndefined();
  const uploaded = await peer(built.base, respond(204, {}));
  call(built, {
    binding: "http",
    origin: uploaded.origin,
    operation: "store",
    parameters: '{"key":"k","data":"AP+A"}',
  });
  const upload = await received(uploaded);
  expect(header(upload.head, "content-type")).toBe("application/octet-stream");
  expect([...upload.body]).toEqual([0, 255, 128]);
});
