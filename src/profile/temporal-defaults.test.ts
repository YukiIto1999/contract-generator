import { expect, test } from "vite-plus/test";
import { codesFrom, modelFrom, objectFrom } from "./profile-source.fixture.js";

/**
 * Complete input declaring one optional field with a temporal constructor default
 * @param scalar - Temporal scalar name
 * @param text - Lexical argument of the constructor
 * @returns TypeSpec source for the declaration
 */
function temporalSource(scalar: string, text: string): string {
  return `namespace Public; model Input { @providerDefault(${scalar}.fromISO("${text}")) value?: ${scalar}; }`;
}

test.each(["P2W", "P1Y2M3DT4H5M6.5S", "PT0S", "-P1D", "P10W", "PT1.25S", "P1M"])(
  "the duration default %s is accepted and kept as written",
  async (text) => {
    const model = await modelFrom(temporalSource("duration", text));
    expect(objectFrom(model, "Input").fields[0]?.default).toEqual({ kind: "string", value: text });
  },
);

test.each(["P1Y2W", "P2W3D", "-P2W", "P", "PT", "P1YT", "P1.5D", "p2w", "2W", "PW"])(
  "the duration default %s is not a date-time form and not a bare week form",
  async (text) => {
    expect(await codesFrom(temporalSource("duration", text))).toContain("invalid-default");
  },
);

test.each(["2024-05-06T07:08:09Z", "2024-05-06T07:08:09+00:00", "2024-05-06T07:08:09.123-00:00"])(
  "the utcDateTime default %s has a zero offset and is accepted",
  async (text) => {
    const model = await modelFrom(temporalSource("utcDateTime", text));
    expect(objectFrom(model, "Input").fields[0]?.default).toEqual({ kind: "string", value: text });
  },
);

test.each(["2024-05-06T07:08:09+01:00", "2024-05-06T07:08:09-05:30", "2024-05-06T07:08:09+00:01"])(
  "the utcDateTime default %s has a nonzero offset and is rejected",
  async (text) => {
    expect(await codesFrom(temporalSource("utcDateTime", text))).toContain("invalid-default");
  },
);

test("an offsetDateTime default keeps any offset", async () => {
  const text = "2024-05-06T07:08:09.5+05:45";
  const model = await modelFrom(temporalSource("offsetDateTime", text));
  expect(objectFrom(model, "Input").fields[0]?.default).toEqual({ kind: "string", value: text });
});

test("a utcDateTime leap second is accepted only on the final UTC minute of June or December", async () => {
  const accepted = await modelFrom(temporalSource("utcDateTime", "2016-12-31T23:59:60Z"));
  expect(objectFrom(accepted, "Input").fields[0]?.default).toEqual({
    kind: "string",
    value: "2016-12-31T23:59:60Z",
  });
  expect(await codesFrom(temporalSource("utcDateTime", "2016-11-30T23:59:60Z"))).toContain(
    "invalid-default",
  );
});
