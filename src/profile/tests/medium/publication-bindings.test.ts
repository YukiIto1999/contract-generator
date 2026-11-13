import { expect, test } from "vite-plus/test";
import { codesFrom, modelFrom } from "./profile-source.fixture.js";

/** Operation with one void outcome and no publication or binding declaration */
const bare = `namespace Public;
  @outcomes union Result { ok: void }
  op run(): Result;`;

test("an operation without any publication cannot be compiled", async () => {
  const codes = await codesFrom(bare);
  expect(codes).toEqual(expect.arrayContaining(["publication-count", "missing-binding"]));
});

test("a publication that lists no transport cannot be compiled", async () => {
  expect(await codesFrom(`${bare} @@publish(run, #[]);`)).toContain("missing-binding");
});

test("an operation published over HTTP only carries a complete HTTP binding and no IPC binding", async () => {
  const model = await modelFrom(`${bare}
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "ok", 204);`);
  const operation = model.operations[0];
  expect(operation?.ipc).toBeUndefined();
  expect(operation?.http).toMatchObject({
    method: "GET",
    path: "/run",
    body: { kind: "none" },
    results: [{ outcome: "Ok", status: 204 }],
  });
});

test("an operation published over both transports carries both bindings complete", async () => {
  const model = await modelFrom(`${bare}
    @@publish(run, #["http", "ipc"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "ok", 204);
    @@ipcBinding(run, "run");
    @@ipcResult(run, "ok", "ok");`);
  const operation = model.operations[0];
  expect(operation?.http?.results).toHaveLength(operation?.outcomes.length ?? -1);
  expect(operation?.ipc?.results).toHaveLength(operation?.outcomes.length ?? -1);
});

test("binding declarations without the matching publication are rejected", async () => {
  const codes = await codesFrom(`${bare}
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "ok", 204);
    @@ipcBinding(run, "run");
    @@ipcResult(run, "ok", "ok");`);
  expect(codes).toContain("unpublished-binding");
});

test("a published transport without its binding declaration is rejected", async () => {
  expect(await codesFrom(`${bare} @@publish(run, #["http"]);`)).toContain("http-binding-count");
  expect(await codesFrom(`${bare} @@publish(run, #["ipc"]);`)).toContain("ipc-binding-count");
});

test("a transport listed twice and two publication declarations are rejected", async () => {
  expect(await codesFrom(`${bare} @@publish(run, #["ipc", "ipc"]);`)).toContain(
    "duplicate-binding",
  );
  const codes = await codesFrom(`${bare} @@publish(run, #["ipc"]); @@publish(run, #["http"]);`);
  expect(codes).toContain("publication-count");
});
