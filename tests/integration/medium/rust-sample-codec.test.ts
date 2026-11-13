import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import { decode } from "./rust/drivers.js";
import { build, dispose, type Native } from "./rust/native.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 1_800_000 });
const native = test;
let built: Native;

beforeAll(async () => {
  built = await build("sample");
});
afterAll(async () => {
  await dispose(built);
});

/** Independently specified accepted canonical wire payload */
const envelope =
  '{"requestId":"00000000-0000-0000-0000-000000000001","recordId":"00000000-0000-0000-0000-000000000002","correlationId":"00000000-0000-0000-0000-000000000003","label":"😀😀😀","count":3,"amount":"9007199254740993123456789.123456789012345678900","occurredAt":"0000-02-29T12:34:56.1234567890123456789+05:45","nullableText":null,"items":[{"kind":"text","text":"😀"}]}';

native(
  "preserves a long exact decimal and an offset timestamp with year zero in the public codec",
  () => {
    const observation = decode(built, "Envelope", envelope);
    expect(observation.accepted).toBe(true);
    const encoded = JSON.parse(String(observation.encoded)) as Record<string, unknown>;
    expect(encoded.amount).toBe("9007199254740993123456789.123456789012345678900");
    expect(encoded.occurredAt).toBe("0000-02-29T12:34:56.1234567890123456789+05:45");
    expect(decode(built, "ExactDecimal", '"-0.000E+02"')).toMatchObject({
      accepted: true,
      encoded: '"-0.000E+02"',
    });
  },
);

native("accepts leap seconds only at a UTC month end and keeps their spelling", () => {
  for (const leap of ["1990-12-31T23:59:60Z", "1991-01-01T05:44:60.1234567890123456789+05:45"])
    expect(decode(built, "ExactTimestamp", JSON.stringify(leap))).toMatchObject({
      accepted: true,
      encoded: JSON.stringify(leap),
    });
  for (const invalid of [
    "1990-12-31T23:58:60Z",
    "0000-02-29T23:59:60.1234567890123456789+05:45",
    "2024-02-29T23:59:60Z",
  ])
    expect(decode(built, "ExactTimestamp", JSON.stringify(invalid)).violations).toEqual([
      { path: "", rule: "format" },
    ]);
});

native("measures length in Unicode code points rather than in UTF-8 bytes", () => {
  expect(decode(built, "ShortLabel", '"😀😀😀"').accepted).toBe(true);
  expect(decode(built, "ShortLabel", '"😀😀😀😀"').violations).toEqual([
    { path: "", rule: "maxLength" },
  ]);
  expect(decode(built, "ShortLabel", '""').violations).toEqual([{ path: "", rule: "minLength" }]);
});

native("rejects a missing required nullable member", () => {
  const missing = JSON.parse(envelope) as Record<string, unknown>;
  delete missing.nullableText;
  expect(decode(built, "Envelope", JSON.stringify(missing)).violations).toContainEqual({
    path: "/nullableText",
    rule: "required",
  });
});

native("rejects an explicit null for an optional non-nullable member", () => {
  const payload = envelope.replace(
    '"nullableText":null',
    '"nullableText":null,"optionalText":null',
  );
  expect(decode(built, "Envelope", payload).violations).toContainEqual({
    path: "/optionalText",
    rule: "null",
  });
});

native("keeps an explicit null of an optional nullable member apart from its omission", () => {
  const accepted = decode(
    built,
    "Envelope",
    envelope.replace('"nullableText":null', '"nullableText":null,"optionalNullable":null'),
  );
  expect(accepted.accepted).toBe(true);
  expect(JSON.parse(String(accepted.encoded))).toHaveProperty("optionalNullable", null);
  expect(JSON.parse(String(decode(built, "Envelope", envelope).encoded))).not.toHaveProperty(
    "optionalNullable",
  );
});

native(
  "reports nested unknown names with their positions while still rejecting known-member violations",
  () => {
    const payload = envelope.replace(
      '"text":"😀"',
      '"text":"😀😀😀😀","secret":{"credential":"not retained"}',
    );
    const observation = decode(built, "Envelope", payload);
    expect(observation.accepted).toBe(false);
    expect(observation.diagnostics).toContainEqual({ path: "/items/0", key: "secret" });
    expect(observation.violations).toContainEqual({ path: "/items/0/text", rule: "maxLength" });
  },
);

native("never retains or re-sends an unknown member value", () => {
  const accepted = decode(
    built,
    "Envelope",
    envelope.replace('"text":"😀"', '"text":"😀","secret":{"credential":"not retained"}'),
  );
  expect(accepted.accepted).toBe(true);
  expect(String(accepted.encoded)).not.toContain("credential");
  expect(String(accepted.encoded)).not.toContain("secret");
});

native("rejects an unknown variant tag and a payload that does not match its tag", () => {
  expect(
    decode(built, "Envelope", envelope.replace('"kind":"text"', '"kind":"unknown"')).violations,
  ).toContainEqual({ path: "/items/0/kind", rule: "variant" });
  const mismatch = decode(
    built,
    "Envelope",
    envelope.replace('{"kind":"text","text":"😀"}', '{"kind":"text","bytes":"AP+A"}'),
  );
  expect(mismatch.accepted).toBe(false);
  expect(mismatch.violations).toContainEqual({ path: "/items/0/text", rule: "required" });
  expect(mismatch.diagnostics).toContainEqual({ path: "/items/0", key: "bytes" });
});

native("decodes a binary variant whose bytes are not UTF-8", () => {
  const accepted = decode(
    built,
    "Envelope",
    envelope.replace('{"kind":"text","text":"😀"}', '{"kind":"binary","bytes":"AP+A"}'),
  );
  expect(accepted.accepted).toBe(true);
  expect(String(accepted.encoded)).toContain('"bytes":"AP+A"');
});
