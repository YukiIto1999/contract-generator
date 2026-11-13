import { expect, test } from "vite-plus/test";
import { renderProjections } from "../../../projections/render-projections.js";
import {
  compileSource,
  issuesFrom,
  modelFrom,
  objectFrom,
  scalarFrom,
} from "./profile-source.fixture.js";

const longRun = "a".repeat(16_384);

const defaultSource = (pattern: string, value: string) => `namespace Public;
  @pattern(${JSON.stringify(pattern)}) scalar Text extends string;
  model Input { @providerDefault(${JSON.stringify(value)}) value?: Text; }`;

test.each([
  ["nested repetition", "^(a+)+$", longRun, `${longRun}!`],
  ["overlapping alternation", "^(a|aa)+$", longRun, `${longRun}!`],
  ["unanchored search", "(a+)+b", `!${longRun}b!`, `${longRun}!`],
])("%s checks finite adversarial provider defaults", async (_name, pattern, accepted, rejected) => {
  const model = await modelFrom(defaultSource(pattern, accepted));
  expect(objectFrom(model, "Input").fields[0]?.default).toEqual({
    kind: "string",
    value: accepted,
  });
  const { issues } = await issuesFrom(defaultSource(pattern, rejected));
  expect(issues.map((issue) => issue.code)).toEqual(["invalid-default"]);
});

test.each([
  ["strict end anchor", "^a$", "a", "a\n"],
  ["Unicode scalar dot", "^.$", "😀", "\u2028"],
  ["ECMAScript whitespace", "^\\s$", "\ufeff", "\u0085"],
  ["ASCII word set without case folding", "^\\w$", "K", "K"],
  ["empty alternative", "^(?:a|)$", "", "b"],
])("%s has explicit provider-default membership", async (_name, pattern, accepted, rejected) => {
  const model = await modelFrom(defaultSource(pattern, accepted));
  expect(objectFrom(model, "Input").fields[0]?.default).toEqual({
    kind: "string",
    value: accepted,
  });
  const { issues } = await issuesFrom(defaultSource(pattern, rejected));
  expect(issues.map((issue) => issue.code)).toEqual(["invalid-default"]);
});

test.each([
  ["lookahead", "^(?=a)a+$"],
  ["lookbehind", "(?<=a)b"],
  ["backreference", "^(a+)\\1$"],
  ["word boundary", "\\ba+\\b"],
  ["Unicode property", "\\p{Letter}+"],
  ["engine repetition limit", "a{1001}"],
  ["nested repetition limit", "(?:a{100}){100}"],
])("%s is rejected before a cheap-failing provider default", async (_name, pattern) => {
  const source = `namespace Public;
@minLength(2) @pattern(${JSON.stringify(pattern)}) scalar Unsafe extends string;
model Input { @providerDefault("!") value?: Unsafe; }`;
  const { program, result } = await compileSource(source);
  expect(program.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(result.isErr()).toBe(true);
  const issues = result.unwrapErr();
  expect(issues.map((issue) => issue.code)).toEqual(["unsupported-pattern"]);
});

test("unsupported pattern diagnostics locate the authored declaration in the compiler source", async () => {
  const declaration = '@pattern("(?=a)a") scalar Unsafe extends string;';
  const { program, result } = await compileSource(
    `namespace Public;\nscalar Other extends string;\n  ${declaration}`,
  );
  const issues = result.unwrapErr();
  expect(issues.map((issue) => issue.code)).toEqual(["unsupported-pattern"]);
  const file = [...program.sourceFiles.values()].find((source) =>
    source.file.text.includes(declaration),
  )!.file;
  const start = file.text.indexOf(declaration);
  const prefix = file.text.slice(0, start);
  const issue = issues[0]!;
  expect(issue.target).toBe("profile");
  expect(issue.origin.file).toMatch(/^(?!\/)(?:.*\/)?main\.tsp$/);
  expect(issue.origin).toMatchObject({
    start,
    end: start + declaration.length,
    line: prefix.split("\n").length,
    column: start - prefix.lastIndexOf("\n"),
  });
  expect(file.text.slice(issue.origin.start, issue.origin.end)).toBe(declaration);
});

test("unsupported syntax cannot hide behind a failing UUID guard", async () => {
  const { issues } = await issuesFrom(`namespace Public;
    @format("uuid") @pattern("(?=a)a") scalar Identifier extends string;
    model Input { @providerDefault("not-a-uuid") value?: Identifier; }`);
  expect(issues.map((issue) => issue.code)).toEqual(["unsupported-pattern"]);
});

test("syntax accepted without Unicode mode is rejected by the profile's Unicode grammar", async () => {
  const { program, result } = await compileSource(defaultSource("\\q", "q"));
  expect(program.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  expect(result.isErr()).toBe(true);
  expect(result.unwrapErr().map((issue) => issue.code)).toEqual(["invalid-pattern"]);
});

test.each([
  ["literal", `model Input { @pattern("^(a+)+$") value: ${JSON.stringify(`${longRun}!`)}; }`],
  [
    "enum",
    `enum Choice { accepted: ${JSON.stringify(longRun)}, rejected: ${JSON.stringify(`${longRun}!`)} }
    model Input { @pattern("^(a+)+$") value: Choice; }`,
  ],
])(
  "the frontend rejects direct constrained %s declarations before inhabitation",
  async (_name, declarations) => {
    const { issues } = await issuesFrom(`namespace Public; ${declarations}`);
    expect(issues.map((issue) => issue.code)).toContain("compiler:decorator-wrong-target");
  },
);

test("translation never replaces the authored pattern in canonical IR or schema projections", async () => {
  const pattern = "^(?<letter>a|😀)[\\s\\S]*$";
  const model = await modelFrom(defaultSource(pattern, "😀\ufeff"));
  const scalar = scalarFrom(model, "Text");
  expect(scalar.constraints.pattern).toBe(pattern);
  const files = renderProjections(model);
  for (const path of ["schemas/http.schema.json", "schemas/ipc.schema.json"]) {
    const file = files.find((candidate) => candidate.path === path);
    expect(file).toBeDefined();
    const document: unknown = JSON.parse(file!.content);
    expect(document).toMatchObject({ $defs: { [scalar.id]: { pattern } } });
  }
});
