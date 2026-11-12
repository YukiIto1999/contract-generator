import { expect, test } from "vite-plus/test";
import { fixtureTester, modelFrom, objectFrom, scalarFrom } from "./profile-source.fixture.js";

/** Complete model of the shared contract fixture, compiled once for the read-only assertions */
const sample = await modelFrom("", "Sample", fixtureTester);

/** Object of the shared fixture whose fields cover every presence and nullability combination */
const envelope = objectFrom(sample, "Envelope");

test("the shared fixture keeps its namespace, operation names and relative origins", () => {
  expect(sample.namespace).toBe("Sample");
  expect(sample.operations.map((operation) => operation.name)).toEqual(["download", "submit"]);
  expect(sample.types.every((type) => !type.origin.file.startsWith("/"))).toBe(true);
});

test("two roles with the same representation stay separate and an alias keeps the role", () => {
  const requestId = scalarFrom(sample, "RequestId");
  const recordId = scalarFrom(sample, "RecordId");
  expect(requestId.role).toBe("Sample.RequestId");
  expect(recordId.role).toBe("Sample.RecordId");
  expect(requestId.constraints.format).toBe("uuid");
  expect(sample.types.some((type) => type.name === "CorrelationId")).toBe(false);
  expect(envelope.fields.find((field) => field.name === "correlationId")?.type.id).toBe(
    requestId.id,
  );
});

test("required, optional and nullable fields keep presence independent of null", () => {
  const field = (name: string) => envelope.fields.find((candidate) => candidate.name === name);
  expect(field("nullableText")).toMatchObject({ optional: false, type: { nullable: true } });
  expect(field("optionalText")).toMatchObject({ optional: true, type: { nullable: false } });
  expect(field("optionalNullable")).toMatchObject({ optional: true, type: { nullable: true } });
  expect(field("items")?.type.constraints.minItems).toBe(1);
});

test("lexical scalars keep their representation and encodings for both bindings", () => {
  expect(scalarFrom(sample, "ExactDecimal")).toMatchObject({
    role: null,
    scalar: "decimal",
    preserveLexical: true,
    encodings: { http: "string", ipc: "string" },
  });
  expect(scalarFrom(sample, "ExactTimestamp")).toMatchObject({
    role: null,
    scalar: "offsetDateTime",
    preserveLexical: true,
    encodings: { http: "rfc3339", ipc: "rfc3339" },
  });
});

test("a discriminated union of declared models lists the declared models as variants", () => {
  const item = sample.types.find((type) => type.name === "Item");
  if (item?.kind !== "union") throw new Error("Missing union Item");
  expect(item.variants.map((variant) => variant.tag)).toEqual(["binary", "text"]);
  expect(item.variants.map((variant) => variant.type.id)).toEqual([
    "Sample.BinaryItem",
    "Sample.TextItem",
  ]);
  expect(sample.types.filter((type) => type.id.includes("$variant$"))).toEqual([]);
});

test("the shared fixture publishes both bindings completely and no operation restates the publication", () => {
  const submit = sample.operations.find((operation) => operation.name === "submit");
  expect(submit).toBeDefined();
  expect(submit !== undefined && "publications" in submit).toBe(false);
  expect(submit?.http?.results.map((result) => [result.outcome, result.status])).toEqual([
    ["Completed", 204],
    ["Created", 201],
    ["Queued", 202],
    ["Rejected", 400],
  ]);
  expect(submit?.ipc?.results.map((result) => [result.outcome, result.tag])).toEqual([
    ["Completed", "completed"],
    ["Created", "created"],
    ["Queued", "queued"],
    ["Rejected", "rejected"],
  ]);
  expect(submit?.outcomes.find((outcome) => outcome.name === "Rejected")?.rejection).toBe(true);
});

test("a provider default on an operation parameter keeps its exact numeral", () => {
  const submit = sample.operations.find((operation) => operation.name === "submit");
  const input = sample.types.find((type) => type.id === submit?.input);
  if (input?.kind !== "object") throw new Error("Missing operation input");
  expect(input.fields.find((field) => field.name === "limit")?.default).toEqual({
    kind: "number",
    text: "3",
  });
  expect(
    sample.operations[0]?.http?.results.find((result) => result.outcome === "Downloaded")
      ?.mediaType,
  ).toBe("application/octet-stream");
});

test("an arbitrary namespace and inherited nominal role keep named validators and encodings", async () => {
  const model = await modelFrom(
    `namespace Other.Api;
    @distinct @minLength(1) scalar Role extends string;
    @maxLength(3) scalar Narrow extends Role;
    @distinct scalar Different extends Narrow;
    alias Same = Role;
    @@bindingEncoding(Role, "http", "string");
    @@bindingEncoding(Narrow, "ipc", "string");
    model Container {
      original: Role;
      aliased: Same;
      narrowed: Narrow;
      different: Different;
      @maxLength(2) local: Narrow;
      embedded: { marker: "embedded"; };
      values: Narrow[];
    }`,
    "Other.Api",
  );
  const role = scalarFrom(model, "Role");
  const narrow = scalarFrom(model, "Narrow");
  expect(role.role).toBe("Other.Api.Role");
  expect(narrow).toMatchObject({
    role: role.id,
    constraints: { minLength: 1, maxLength: 3 },
    encodings: { http: "string", ipc: "string" },
  });
  expect(scalarFrom(model, "Different").role).toBe("Other.Api.Different");
  const container = objectFrom(model, "Container");
  const use = (name: string) => container.fields.find((field) => field.name === name)?.type;
  expect(use("aliased")?.id).toBe(role.id);
  expect(use("narrowed")?.id).toBe(narrow.id);
  expect(use("local")?.constraints).toEqual({ maxLength: 2 });
  expect(model.types.find((type) => type.id === use("embedded")?.id)).toMatchObject({
    kind: "object",
    exported: false,
  });
  expect(model.types.find((type) => type.id === use("values")?.id)).toMatchObject({
    kind: "array",
    exported: false,
    element: { id: narrow.id },
  });
});

test("scalar and property encoding declarations never overwrite the other binding", async () => {
  const model = await modelFrom(`namespace Public;
    @encode("base64url") scalar Data extends bytes;
    @@bindingEncoding(Data, "http", "base64");
    model Packet { data: Data; }
    @@bindingEncoding(Packet.data, "ipc", "base64");`);
  expect(scalarFrom(model, "Data").encodings).toEqual({ http: "base64", ipc: "base64url" });
  expect(objectFrom(model, "Packet").fields[0]?.type.encodings).toEqual({ ipc: "base64" });
});

test("declaration and field ordering is ordinal rather than discovery dependent", async () => {
  const first = await modelFrom(
    "namespace Public; model Z { b: string; a: int32; } model A { z: Z; }",
  );
  const second = await modelFrom(
    "namespace Public; model A { z: Z; } model Z { a: int32; b: string; }",
  );
  const shape = (types: typeof first.types) =>
    types.map((type) => ({
      id: type.id,
      name: type.name,
      kind: type.kind,
      fields: type.kind === "object" ? type.fields.map((field) => field.name) : [],
    }));
  expect(shape(first.types)).toEqual(shape(second.types));
  expect(objectFrom(first, "Z").fields.map((field) => field.name)).toEqual(["a", "b"]);
});
