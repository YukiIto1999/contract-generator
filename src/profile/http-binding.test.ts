import { NoTarget, getSourceLocation } from "@typespec/compiler";
import { expect, test } from "vite-plus/test";
import { reportIssues } from "./compile-contract.js";
import { codesFrom, httpSource, issuesFrom, modelFrom } from "./profile-source.fixture.js";

test.each([
  [
    "different exact statuses",
    '@@httpResult(execute, "first", 201, "application/json"); @@httpResult(execute, "second", 202, "application/json");',
  ],
  [
    "different media essences",
    '@@httpResult(execute, "first", 200, "application/json"); @@httpResult(execute, "second", 200, "application/problem+json");',
  ],
  [
    "disjoint header values",
    '@@httpResult(execute, "first", 200, "application/json", #{`X-Case`: "first"}); @@httpResult(execute, "second", 200, "APPLICATION/JSON; charset=utf-8", #{`x-case`: "second"});',
  ],
])("same-shaped payloads remain distinct through %s", async (_name, mappings) => {
  const model = await modelFrom(httpSource(mappings));
  expect(model.operations[0]?.http?.results.map((result) => result.outcome)).toEqual([
    "Done",
    "First",
    "Second",
  ]);
});

test.each([
  [
    "identical selectors",
    '@@httpResult(execute, "first", 200, "application/json"); @@httpResult(execute, "second", 200, "application/json");',
  ],
  [
    "subset header selectors",
    '@@httpResult(execute, "first", 200, "application/json", #{`x-case`: "same"}); @@httpResult(execute, "second", 200, "application/json", #{`x-case`: "same", `x-extra`: "present"});',
  ],
  [
    "independent headers can coexist",
    '@@httpResult(execute, "first", 200, "application/json", #{`x-left`: "a"}); @@httpResult(execute, "second", 200, "application/json", #{`x-right`: "b"});',
  ],
])("%s fail even when body shapes could be guessed", async (_name, mappings) => {
  const { issues, program } = await issuesFrom(httpSource(mappings));
  const conflicts = issues.filter((issue) => issue.code === "ambiguous-http-outcome");
  expect(conflicts.length).toBeGreaterThan(0);
  expect(new Set(conflicts.map((issue) => issue.origin.start)).size).toBe(2);
  expect(conflicts.every((issue) => issue.subject === "Public.execute")).toBe(true);
  expect(conflicts.every((issue) => issue.reason.includes("first and second"))).toBe(true);
  const before = program.diagnostics.length;
  reportIssues(program, issues);
  const reported = program.diagnostics.slice(before);
  expect(reported.length).toBe(issues.length);
  for (const diagnostic of reported) {
    expect(diagnostic.target).not.toBe(NoTarget);
    const location = getSourceLocation(diagnostic.target);
    expect(location?.file.path.endsWith("/main.tsp")).toBe(true);
    expect(location?.end).toBeGreaterThan(location?.pos ?? 0);
  }
});

test.each([
  [
    "void cannot have media",
    "void",
    '@@httpResult(run, "ok", 204, "application/json");',
    "void-media-type",
  ],
  [
    "JSON null cannot use a bodyless status",
    "null",
    '@@httpResult(run, "ok", 204, "application/json");',
    "forbidden-response-body",
  ],
  ["out of range status", "void", '@@httpResult(run, "ok", 700);', "invalid-http-status"],
])("%s", async (_name, payload, mapping, expected) => {
  const codes = await codesFrom(
    `namespace Public; @outcomes union Result { ok: ${payload} } op run(): Result; @@publish(run, #["http"]); @@httpBinding(run, "GET", "/run"); ${mapping}`,
  );
  expect(codes).toContain(expected);
});

test.each([
  ["success cannot use a gateway status", false, 503],
  ["rejection cannot use a success status", true, 200],
  ["success cannot use a redirect status", false, 302],
  ["rejection cannot use a redirect status", true, 302],
])("%s", async (_name, rejection, status) => {
  const codes = await codesFrom(
    `namespace Public; ${rejection ? "@error" : ""} model Payload { message: string; } @outcomes union Result { value: Payload } op run(): Result; @@publish(run, #["http"]); @@httpBinding(run, "GET", "/run"); @@httpResult(run, "value", ${status}, "application/json");`,
  );
  expect(codes).toContain("invalid-outcome-status");
});

test("missing request placements and mismatched path placeholders are not silently ignored", async () => {
  const codes = await codesFrom(`namespace Public;
    @outcomes union Result { ok: void }
    op run(id?: string, extra: string): Result;
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", "/run/{other}", "-");
    @@httpParameter(run, "id", "path", "id");
    @@httpResult(run, "ok", 204);`);
  expect(codes).toEqual(
    expect.arrayContaining([
      "optional-path-parameter",
      "missing-path-parameter",
      "unused-path-parameter",
      "missing-parameter-binding",
    ]),
  );
});

test("a bytes body parameter is a raw octet-stream request and any other body is JSON", async () => {
  const model = await modelFrom(`namespace Public;
    @outcomes union Result { ok: void }
    op upload(data: bytes): Result;
    op create(name: string): Result;
    @@publish(upload, #["http"]);
    @@httpBinding(upload, "POST", "/upload", "data");
    @@httpResult(upload, "ok", 204);
    @@publish(create, #["http"]);
    @@httpBinding(create, "POST", "/create");
    @@httpResult(create, "ok", 204);`);
  const media = (name: string) =>
    model.operations.find((operation) => operation.name === name)?.http?.requestMediaType;
  expect(media("upload")).toBe("application/octet-stream");
  expect(media("create")).toBe("application/json");
});
