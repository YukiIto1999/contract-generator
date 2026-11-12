import { expect, test } from "vite-plus/test";
import { compareText } from "../model/ordering.js";
import { codesFrom, issuesFrom, modelFrom, objectFrom } from "./profile-source.fixture.js";

test("modern discriminator metadata is normalized without implicit wire fields", async () => {
  const model = await modelFrom(`namespace Public;
    model Message { text: string; }
    @discriminated(#{envelope: "none", discriminatorPropertyName: "kind"})
    union Inline { message: Message }
    @discriminated(#{discriminatorPropertyName: "tag", envelopePropertyName: "payload"})
    union Wrapped { text: string, empty: null }
    model Root { inline: Inline; wrapped: Wrapped; }`);
  const inline = model.types.find((type) => type.name === "Inline");
  if (inline?.kind !== "union") throw new Error("Missing union Inline");
  const payload = model.types.find((type) => type.id === inline.variants[0]?.type.id);
  expect(payload?.kind).toBe("object");
  if (payload?.kind === "object")
    expect(payload.fields.map((field) => field.wireName)).toEqual(["kind", "text"]);
  const wrapped = model.types.find((type) => type.name === "Wrapped");
  if (wrapped?.kind !== "union") throw new Error("Missing union Wrapped");
  expect(wrapped.variants.map((variant) => variant.tag)).toEqual(["empty", "text"]);
});

test("a variant model that declares the discriminator is the union variant itself", async () => {
  const model = await modelFrom(`namespace Public;
    model Text { kind: "text"; text: string; }
    model Binary { kind: "binary"; bytes: bytes; }
    @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
    union Item { text: Text, binary: Binary }
    model Root { items: Item[]; }`);
  const item = model.types.find((type) => type.name === "Item");
  if (item?.kind !== "union") throw new Error("Missing union Item");
  expect(item.discriminator).toBe("kind");
  expect(item.variants.map((variant) => [variant.tag, variant.type.id])).toEqual([
    ["binary", "Public.Binary"],
    ["text", "Public.Text"],
  ]);
  expect(
    model.types.filter((type) => type.id.includes("$variant$") || type.name.endsWith("Variant")),
  ).toEqual([]);
  expect(objectFrom(model, "Text").fields.map((field) => field.wireName)).toEqual(["kind", "text"]);
});

test("a variant model lacking the discriminator and an envelope keep distinct synthesized wire objects", async () => {
  const model = await modelFrom(`namespace Public;
    model Message { text: string; }
    @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
    union Inline { message: Message }
    @discriminated(#{ discriminatorPropertyName: "tag", envelopePropertyName: "payload" })
    union Wrapped { text: string }
    model Root { inline: Inline; wrapped: Wrapped; }`);
  const inline = model.types.find((type) => type.name === "Inline");
  const wrapped = model.types.find((type) => type.name === "Wrapped");
  if (inline?.kind !== "union" || wrapped?.kind !== "union")
    throw new Error("Missing discriminated unions");
  expect(inline.variants[0]?.type.id).toBe("Public.Inline$variant$message");
  expect(wrapped.variants[0]?.type.id).toBe("Public.Wrapped$variant$text");
  const synthesized = model.types.find((type) => type.id === "Public.Inline$variant$message");
  expect(synthesized).toMatchObject({
    kind: "object",
    name: "InlineMessageVariant",
    exported: false,
  });
  if (synthesized?.kind === "object")
    expect(synthesized.fields.map((field) => field.wireName)).toEqual(["kind", "text"]);
  expect(objectFrom(model, "Message").fields.map((field) => field.wireName)).toEqual(["text"]);
});

test("duplicate inherited discriminator values are reported once per derived model", async () => {
  const { issues } = await issuesFrom(
    'namespace Public; @discriminator("kind") model Pet { kind: string; } model Cat extends Pet { kind: "same"; } model Dog extends Pet { kind: "same"; }',
  );
  const duplicates = issues.filter(
    (issue) =>
      issue.code === "compiler:invalid-discriminator-value" && issue.reason.includes('"same"'),
  );
  expect(duplicates.map((issue) => issue.subject).sort(compareText)).toEqual([
    "Public.Cat",
    "Public.Dog",
  ]);
  expect(new Set(duplicates.map((issue) => issue.origin.start)).size).toBe(2);
  expect(duplicates.every((issue) => issue.target === "profile" && issue.origin.line > 0)).toBe(
    true,
  );
});

test("duplicate tagged variant values are a compiler diagnostic", async () => {
  const codes = await codesFrom(
    'namespace Public; model Left { kind: "same"; } model Right { kind: "same"; } @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union Choice { left: Left, right: Right }',
  );
  expect(codes).toContain("compiler:invalid-discriminated-union-variant");
});

test.each([
  ["a different literal", 'kind: "other";'],
  ["a non-literal type", "kind: string;"],
])("a declared discriminator with %s is rejected at its declaration", async (_name, property) => {
  const { issues } = await issuesFrom(
    `namespace Public; model Text { ${property} } @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union Item { text: Text }`,
  );
  const mismatches = issues.filter(
    (issue) => issue.code === "compiler:invalid-discriminated-union-variant",
  );
  expect(mismatches.length).toBeGreaterThan(0);
  expect(
    mismatches.every(
      (issue) =>
        issue.target === "profile" && issue.origin.line > 0 && !issue.origin.file.startsWith("/"),
    ),
  ).toBe(true);
});

test.each([
  ["an optional property", 'kind?: "text";', "invalid-discriminator", "Public.Text.kind"],
  [
    "a wire name changed by @encodedName",
    '@encodedName("application/json", "type") kind: "text";',
    "encoded-discriminator",
    "Public.Text.kind",
  ],
])(
  "a declared discriminator as %s is rejected by the profile",
  async (_name, property, code, subject) => {
    const { issues } = await issuesFrom(
      `namespace Public; model Text { ${property} } @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" }) union Item { text: Text }`,
    );
    const rejected = issues.filter((issue) => issue.code === code);
    expect(rejected.map((issue) => issue.subject)).toEqual([subject]);
    expect(
      rejected.every(
        (issue) =>
          issue.target === "profile" && issue.origin.line > 0 && !issue.origin.file.startsWith("/"),
      ),
    ).toBe(true);
  },
);
