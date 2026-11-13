import { expect, test } from "vite-plus/test";
import { codesFrom, issuesFrom, modelFrom } from "./profile-source.fixture.js";

test("IPC result tags are exhaustive and unique independent of payload shape", async () => {
  const codes = await codesFrom(`namespace Public;
    model Payload { value: string; }
    @outcomes union Result { left: Payload, right: Payload }
    op run(): Result;
    @@publish(run, #["ipc"]);
    @@ipcBinding(run, "run");
    @@ipcResult(run, "left", "same");
    @@ipcResult(run, "right", "same");`);
  expect(codes).toContain("duplicate-ipc-tag");
});

test("an outcome added to one binding still needs a mapping in every other required binding", async () => {
  const { issues } = await issuesFrom(`namespace Public;
    @outcomes union Result { ok: void, added: void }
    op run(): Result;
    @@publish(run, #["http", "ipc"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "ok", 204);
    @@ipcBinding(run, "run");
    @@ipcResult(run, "ok", "ok");`);
  expect(
    issues.filter((issue) => issue.code === "missing-outcome-binding").map((issue) => issue.reason),
  ).toEqual(["Outcome added has no HTTP mapping", "Outcome added has no IPC mapping"]);
});

test("an empty tag and an empty or control-character command are rejected", async () => {
  const codes = await codesFrom(`namespace Public;
    @outcomes union Result { ok: void }
    op run(): Result;
    @@publish(run, #["ipc"]);
    @@ipcBinding(run, "bad\\ncommand");
    @@ipcResult(run, "ok", "");`);
  expect(codes).toEqual(expect.arrayContaining(["invalid-ipc-command", "empty-ipc-tag"]));
});

test("two operations cannot share one IPC command", async () => {
  const codes = await codesFrom(`namespace Public;
    @outcomes union Result { ok: void }
    op first(): Result;
    op second(): Result;
    @@publish(first, #["ipc"]);
    @@ipcBinding(first, "same");
    @@ipcResult(first, "ok", "ok");
    @@publish(second, #["ipc"]);
    @@ipcBinding(second, "same");
    @@ipcResult(second, "ok", "ok");`);
  expect(codes).toContain("duplicate-ipc-command");
});

test("an IPC-only operation carries no HTTP binding and keeps its tags", async () => {
  const model = await modelFrom(`namespace Public;
    @outcomes union Result { ok: void }
    op run(): Result;
    @@publish(run, #["ipc"]);
    @@ipcBinding(run, "run");
    @@ipcResult(run, "ok", "done");`);
  const operation = model.operations[0];
  expect(operation?.http).toBeUndefined();
  expect(operation?.ipc?.command).toBe("run");
  expect(operation?.ipc?.results.map((result) => [result.outcome, result.tag])).toEqual([
    ["Ok", "done"],
  ]);
});
