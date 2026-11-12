import { expect, test } from "vite-plus/test";
import { codesFrom, modelFrom } from "./profile-source.fixture.js";

/**
 * GET operation bound to a route template that places every named parameter in the path
 * @param route - Route template
 * @param names - Path parameter names, which are also their placeholder names
 * @returns TypeSpec source for the operation
 */
function routed(route: string, names: readonly string[] = []): string {
  const parameters = names.map((name) => `${name}: string`).join(", ");
  const placements = names
    .map((name) => `@@httpParameter(run, "${name}", "path", "${name}");`)
    .join("\n");
  return `namespace Public;
    @outcomes union Result { ok: void }
    op run(${parameters}): Result;
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", ${JSON.stringify(route)}, "-");
    ${placements}
    @@httpResult(run, "ok", 204);`;
}

test.each([
  ["a leading empty segment", "//run"],
  ["an inner empty segment", "/a//b"],
  ["a repeated trailing slash", "/a//"],
  ["a current-segment dot", "/a/./b"],
  ["a parent-segment dot", "/a/.."],
  ["a leading parent-segment dot", "/../a"],
  ["a percent-encoded dot", "/a/%2e/b"],
  ["a percent-encoded parent segment in either letter case", "/a/%2E%2e"],
  ["a parent segment spelled with a dot and an encoded dot", "/a/.%2E/b"],
  ["a parent segment spelled with an encoded dot and a dot", "/a/%2e./b"],
  ["a backslash that URL parsers read as a slash", "/\\attacker/x"],
])("a route with %s is rejected before generation", async (_name, route) => {
  expect(await codesFrom(routed(route))).toContain("invalid-http-path");
});

test.each([
  ["a literal after the placeholder", "/files/{name}.json"],
  ["two placeholders", "/files/{left}{right}"],
  ["a literal before the placeholder", "/files/v{name}"],
  ["an unclosed placeholder", "/files/{name"],
])(
  "a segment with %s is rejected because a placeholder fills a whole segment",
  async (_name, route) => {
    expect(await codesFrom(routed(route, ["name", "left", "right"]))).toContain(
      "invalid-http-path",
    );
  },
);

test.each([
  ["the root", "/", []],
  ["a literal route", "/run", []],
  ["a trailing slash", "/run/", []],
  ["a leading placeholder", "/{tenant}/{item}/archive", ["tenant", "item"]],
  ["a placeholder before a trailing slash", "/files/{name}/", ["name"]],
  ["dots inside a segment name", "/v1.0/.well-known/a..b/...", []],
  ["a percent-encoded slash", "/a%2Fb/c", []],
])("%s is a valid route", async (_name, route, names) => {
  const model = await modelFrom(routed(route, names));
  expect(model.operations[0]?.http?.path).toBe(route);
});
