import { expect, test } from "vite-plus/test";
import { codesFrom, issuesFrom, modelFrom, objectFrom } from "./profile-source.fixture.js";

test.each([
  ["invalid decorator target", "namespace Public; @distinct model Invalid {}"],
  [
    "invalid publication value",
    'namespace Public; @outcomes union Result { ok: void } op run(): Result; @@publish(run, #["websocket"]);',
  ],
  ["malformed TypeSpec source", "namespace Public; model Broken { value: ; }"],
])("%s becomes a compiler diagnostic Result", async (_name, source) => {
  const { issues } = await issuesFrom(source);
  expect(issues.some((issue) => issue.code.startsWith("compiler:"))).toBe(true);
  expect(
    issues.every(
      (issue) =>
        issue.target === "profile" && !issue.origin.file.startsWith("/") && issue.origin.line > 0,
    ),
  ).toBe(true);
});

test("unregistered semantic annotations are not treated as explanatory documentation", async () => {
  const { issues } = await issuesFrom(
    "namespace Public; model PrivateData { @secret value: string; }",
  );
  expect(issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        code: "unsupported-annotation",
        target: "profile",
        reason: expect.stringContaining("@secret"),
        origin: expect.objectContaining({
          file: expect.stringMatching(/^(?!\/)(?:.*\/)?main\.tsp$/),
          line: expect.any(Number),
        }),
      }),
    ]),
  );
});

test("an unregistered directive is reported at its declaration", async () => {
  const codes = await codesFrom(
    'namespace Public;\n#deprecated "use another"\nmodel Old { value: string; }',
  );
  expect(codes).toContain("unsupported-directive");
});

test("inherited empty domains fail before output", async () => {
  const codes = await codesFrom(
    "namespace Public; @minLength(3) scalar Parent extends string; @maxLength(2) scalar Child extends Parent;",
  );
  expect(codes.some((code) => code === "empty-domain" || code.startsWith("compiler:"))).toBe(true);
});

test.each([
  ["a literal excluded by its use-site restriction", 'model Input { @minLength(2) value: "x"; }'],
  [
    "a UUID excluded by its length",
    '@format("uuid") @maxLength(35) scalar Identifier extends string;',
  ],
  ["required recursion with no finite value", "model Endless { child: Endless; }"],
])("%s has an empty domain", async (_name, declarations) => {
  const codes = await codesFrom(`namespace Public; ${declarations}`);
  expect(codes.some((code) => code === "empty-domain" || code.startsWith("compiler:"))).toBe(true);
});

test("recursive arrays remain inhabited through the empty array", async () => {
  const model = await modelFrom("namespace Public; model Tree { children: Tree[]; }");
  expect(objectFrom(model, "Tree").fields[0]?.type.nullable).toBe(false);
});

test("portable naming conflicts are precise failures", async () => {
  const codes = await codesFrom("namespace Public; model Same_Name {} model SameName {}");
  expect(codes).toContain("naming-conflict");
});

test("object fields that collide after portable naming are rejected", async () => {
  const codes = await codesFrom("namespace Public; model Input { a_b: string; aB: string; }");
  expect(codes).toContain("naming-conflict");
});

test("conflicting binding-specific encodings never use last-writer-wins", async () => {
  const codes = await codesFrom(
    'namespace Public; scalar Data extends bytes; @@bindingEncoding(Data, "http", "base64"); @@bindingEncoding(Data, "http", "base64url");',
  );
  expect(codes).toContain("duplicate-binding-encoding");
});

test("an encoding that does not fit the scalar is rejected", async () => {
  const codes = await codesFrom(
    'namespace Public; scalar Count extends int32; @@bindingEncoding(Count, "ipc", "base64");',
  );
  expect(codes).toContain("invalid-binding-encoding");
});
