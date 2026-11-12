import { expect, test } from "vite-plus/test";
import { validDate, validDateTime, validDuration, validPlainTime } from "./temporal.js";

test.each(["P2W", "P0W", "P1Y", "P1Y2M3D", "PT1H", "P1DT1.5S", "-PT30M"])(
  "%s is a duration",
  (text) => {
    expect(validDuration(text)).toBe(true);
  },
);

test.each(["P", "PT", "P1YT", "P1Y2W", "P1W2D", "-P2W", "pt1h", "P1.5Y", "1W"])(
  "%s is not a duration",
  (text) => {
    expect(validDuration(text)).toBe(false);
  },
);

test.each(["2024-02-29T00:00:00Z", "2024-02-29t00:00:00z", "0000-02-29T00:00:00+00:00"])(
  "%s is a UTC date-time",
  (text) => {
    expect(validDateTime(text, true)).toBe(true);
  },
);

test.each(["2024-02-29T00:00:00+01:00", "2024-02-29T00:00:00-00:30", "2023-02-29T00:00:00Z"])(
  "%s is not a UTC date-time",
  (text) => {
    expect(validDateTime(text, true)).toBe(false);
  },
);

test("an offset date-time keeps every offset a UTC date-time refuses", () => {
  expect(validDateTime("2024-02-29T10:00:00+14:00", false)).toBe(true);
  expect(validDateTime("2024-02-29T10:00:00-00:00", false)).toBe(true);
  expect(validDateTime("2024-02-29T10:00:00+24:00", false)).toBe(false);
});

test("a leap second needs the final UTC minute of June 30 or December 31", () => {
  expect(validDateTime("2016-12-31T23:59:60Z", true)).toBe(true);
  expect(validDateTime("2016-06-30T23:59:60Z", true)).toBe(true);
  expect(validDateTime("2017-01-01T05:44:60+05:45", false)).toBe(true);
  expect(validDateTime("2016-12-31T23:58:60Z", true)).toBe(false);
  expect(validDateTime("2016-12-30T23:59:60Z", true)).toBe(false);
});

test("calendar dates follow the proleptic Gregorian rule including year zero", () => {
  expect(validDate("0000-02-29")).toBe(true);
  expect(validDate("1900-02-29")).toBe(false);
  expect(validDate("2000-02-29")).toBe(true);
  expect(validDate("2024-13-01")).toBe(false);
  expect(validDate("2024-04-31")).toBe(false);
});

test("a plain time has no offset and no leap second", () => {
  expect(validPlainTime("23:59:59.999")).toBe(true);
  expect(validPlainTime("23:59:60")).toBe(false);
  expect(validPlainTime("24:00:00")).toBe(false);
  expect(validPlainTime("12:00:00Z")).toBe(false);
});
