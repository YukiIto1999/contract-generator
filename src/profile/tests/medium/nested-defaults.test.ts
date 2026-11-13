import { expect, test } from "vite-plus/test";
import { codesFrom, modelFrom, objectFrom } from "./profile-source.fixture.js";

/** Contract whose provider defaults sit in a nested object, an array element and union variants */
const nested = `namespace Public;
  model Leaf { @providerDefault(7) size?: int32; }
  model Circle { kind: "circle"; @providerDefault(1e1) radius?: int32; }
  model Square { kind: "square"; @providerDefault("plain") label?: string; }
  @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
  union Shape { circle: Circle, square: Square }
  model Branch { leaf: Leaf; leaves: Leaf[]; shapes: Shape[]; }
  @outcomes union Result { ok: void }
  op draw(branch: Branch, shape: Shape): Result;
  @@publish(draw, #["http"]);
  @@httpBinding(draw, "POST", "/draw");
  @@httpResult(draw, "ok", 204);`;

test("a default on a field of a nested object or an array element object is kept on that object", async () => {
  const model = await modelFrom(nested);
  expect(objectFrom(model, "Leaf").fields[0]?.default).toEqual({ kind: "number", text: "7" });
  const branch = objectFrom(model, "Branch");
  const leafId = objectFrom(model, "Leaf").id;
  const leaves = model.types.find(
    (type) => type.id === branch.fields.find((field) => field.name === "leaves")?.type.id,
  );
  expect(leaves).toMatchObject({ kind: "array", element: { id: leafId } });
  expect(branch.fields.find((field) => field.name === "leaf")?.type.id).toBe(leafId);
});

test("a default on a field of a union variant model is kept on the variant and normalized", async () => {
  const model = await modelFrom(nested);
  expect(
    objectFrom(model, "Circle").fields.find((field) => field.name === "radius")?.default,
  ).toEqual({ kind: "number", text: "10" });
  expect(
    objectFrom(model, "Square").fields.find((field) => field.name === "label")?.default,
  ).toEqual({ kind: "string", value: "plain" });
  const shape = model.types.find((type) => type.name === "Shape");
  expect(shape).toMatchObject({ kind: "union", discriminator: "kind" });
});

test("an invalid default on a nested or variant field is rejected at its own declaration", async () => {
  const codes = await codesFrom(`namespace Public;
    model Square { kind: "square"; @providerDefault(5) label?: string; }
    @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
    union Shape { square: Square }
    model Branch { shapes: Shape[]; }`);
  expect(codes).toContain("invalid-default");
});

test("a default on a synthesized variant payload field is validated like any other", async () => {
  const model = await modelFrom(`namespace Public;
    model Message { @providerDefault("hello") text?: string; }
    @discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })
    union Inline { message: Message }
    model Root { inline: Inline; }`);
  const synthesized = model.types.find((type) => type.id === "Public.Inline$variant$message");
  if (synthesized?.kind !== "object") throw new Error("Missing synthesized variant");
  expect(synthesized.fields.find((field) => field.name === "text")?.default).toEqual({
    kind: "string",
    value: "hello",
  });
});
