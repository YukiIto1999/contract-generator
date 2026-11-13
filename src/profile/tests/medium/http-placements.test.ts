import { expect, test } from "vite-plus/test";
import { codesFrom, issuesFrom, modelFrom } from "./profile-source.fixture.js";

/**
 * GET operation whose single parameter is placed outside the body
 * @param type - Parameter type, possibly nullable or optional through its name
 * @param name - Parameter name including an optional marker
 * @param location - HTTP placement of the parameter
 * @returns TypeSpec source for the operation
 */
function placed(type: string, name: string, location: "path" | "query" | "header"): string {
  const route = location === "path" ? "/run/{value}" : "/run";
  return `namespace Public;
    @outcomes union Result { ok: void }
    op run(${name}: ${type}): Result;
    @@publish(run, #["http"]);
    @@httpBinding(run, "GET", "${route}", "-");
    @@httpParameter(run, "${name.replace("?", "")}", "${location}", "value");
    @@httpResult(run, "ok", 204);`;
}

test.each(["path", "query", "header"] as const)(
  "a nullable %s parameter is rejected because null has no wire form there",
  async (location) => {
    const { issues } = await issuesFrom(placed("string | null", "value", location));
    const nullable = issues.filter((issue) => issue.code === "nullable-http-parameter");
    expect(nullable).toHaveLength(1);
    expect(nullable[0]?.reason).toContain(`The ${location} parameter value`);
    expect(nullable[0]?.target).toBe("profile");
  },
);

test.each(["query", "header"] as const)(
  "a nullable %s parameter is rejected even when it is optional",
  async (location) => {
    expect(await codesFrom(placed("string | null", "value?", location))).toContain(
      "nullable-http-parameter",
    );
  },
);

test.each(["query", "header"] as const)(
  "a required or optional nonnullable %s parameter is accepted",
  async (location) => {
    for (const name of ["value", "value?"]) {
      const model = await modelFrom(placed("string", name, location));
      expect(model.operations[0]?.http?.parameters).toMatchObject([
        { location, wireName: "value" },
      ]);
    }
  },
);

test("a required nonnullable path parameter is accepted and an optional one is not", async () => {
  const model = await modelFrom(placed("string", "value", "path"));
  expect(model.operations[0]?.http?.parameters).toMatchObject([{ location: "path" }]);
  expect(await codesFrom(placed("string", "value?", "path"))).toContain("optional-path-parameter");
});

test("a null-only parameter type is nullable and rejected in every nonbody placement", async () => {
  for (const location of ["path", "query", "header"] as const) {
    expect(await codesFrom(placed("null", "value", location))).toContain("nullable-http-parameter");
  }
});

test("a nullable operation parameter in the body is accepted", async () => {
  const model = await modelFrom(`namespace Public;
    @outcomes union Result { ok: void }
    op run(value: string | null): Result;
    @@publish(run, #["http"]);
    @@httpBinding(run, "POST", "/run");
    @@httpResult(run, "ok", 204);`);
  expect(model.operations[0]?.http?.body).toEqual({ kind: "parameters" });
});
