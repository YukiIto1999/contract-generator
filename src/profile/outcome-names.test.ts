import { expect, test } from "vite-plus/test";
import { issuesFrom } from "./profile-source.fixture.js";

/**
 * Reasons of every issue reported under one rule
 * @param source - Actual malformed profile source
 * @param code - Rule code to select
 * @returns Reasons in report order
 */
async function reasonsFor(source: string, code: string): Promise<readonly string[]> {
  const { issues } = await issuesFrom(source);
  return issues.filter((issue) => issue.code === code).map((issue) => issue.reason);
}

test("a missing mapping names the outcome as written in the source in every binding", async () => {
  const reasons = await reasonsFor(
    `namespace Public;
    @outcomes union Result { ok: void, queued: void, partialSuccess: void }
    op run(): Result;
    @@publish(run, #["http", "ipc"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "ok", 204);
    @@ipcBinding(run, "run");
    @@ipcResult(run, "ok", "ok");`,
    "missing-outcome-binding",
  );
  expect(reasons).toEqual([
    "Outcome partialSuccess has no HTTP mapping",
    "Outcome partialSuccess has no IPC mapping",
    "Outcome queued has no HTTP mapping",
    "Outcome queued has no IPC mapping",
  ]);
});

test("a repeated HTTP or IPC mapping names the outcome as written", async () => {
  const source = `namespace Public;
    @outcomes union Result { queued: void }
    op run(): Result;
    @@publish(run, #["http", "ipc"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "queued", 204);
    @@httpResult(run, "queued", 204);
    @@ipcBinding(run, "run");
    @@ipcResult(run, "queued", "a");
    @@ipcResult(run, "queued", "b");`;
  expect(await reasonsFor(source, "duplicate-outcome-binding")).toEqual([
    "Outcome queued has multiple HTTP mappings",
    "Outcome queued has multiple IPC mappings",
  ]);
});

test("status and media diagnostics name the outcome as written", async () => {
  const source = `namespace Public;
    @error model Failure { message: string; }
    model Payload { value: string; }
    @outcomes union Result { notFound: Failure, createdItem: Payload, emptyReply: void }
    op run(): Result;
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "notFound", 200, "application/json");
    @@httpResult(run, "createdItem", 500);
    @@httpResult(run, "emptyReply", 204, "application/json");`;
  const { issues } = await issuesFrom(source);
  const reason = (code: string) => issues.find((issue) => issue.code === code)?.reason;
  expect(reason("missing-media-type")).toBe(
    "Payload outcome createdItem requires an explicit media type",
  );
  expect(reason("void-media-type")).toBe("Void outcome emptyReply must omit its media type");
  const statusReasons = issues
    .filter((issue) => issue.code === "invalid-outcome-status")
    .map((issue) => issue.reason);
  expect(statusReasons).toEqual([
    "Declared rejection notFound requires a 4xx or 5xx status",
    "Successful outcome createdItem requires a 2xx status",
  ]);
});

test("an ambiguous selector pair and a mixed outcome name the outcomes as written", async () => {
  const { issues } = await issuesFrom(`namespace Public;
    model Success { kind: "success"; }
    @error model Failure { kind: "failure"; }
    @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union Mixed { success: Success, failure: Failure }
    model Payload { value: string; }
    @outcomes union Result { mixedOutcome: Mixed, firstPath: Payload, secondPath: Payload }
    op run(): Result;
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "mixedOutcome", 400, "application/json");
    @@httpResult(run, "firstPath", 200, "application/json");
    @@httpResult(run, "secondPath", 200, "application/json");`);
  const reason = (code: string) => issues.find((issue) => issue.code === code)?.reason;
  expect(reason("ambiguous-outcome-role")).toContain("mixedOutcome");
  expect(reason("ambiguous-http-outcome")).toContain("firstPath and secondPath");
});

test("a portable name collision between outcomes names both authored spellings", async () => {
  const reasons = await reasonsFor(
    `namespace Public;
    @outcomes union Result { partial_success: void, partialSuccess: void }
    op run(): Result;
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", "/run");
    @@httpResult(run, "partial_success", 204);
    @@httpResult(run, "partialSuccess", 204);`,
    "naming-conflict",
  );
  expect(reasons).toHaveLength(1);
  expect(reasons[0]).toContain("partial_success");
  expect(reasons[0]).toContain("partialSuccess");
});
