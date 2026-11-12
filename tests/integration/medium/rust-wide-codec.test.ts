import { afterAll, beforeAll, expect, test, vi } from "vite-plus/test";
import { decode } from "./rust/drivers.js";
import { build, cargoVersion, dispose, type Native } from "./rust/native.js";

vi.setConfig({ testTimeout: 120_000, hookTimeout: 1_800_000 });
const native = test.skipIf(cargoVersion === undefined);
let built: Native;

beforeAll(async () => {
  if (cargoVersion !== undefined) built = await build("wide");
});
afterAll(async () => {
  await dispose(built);
});

/** Independently specified accepted Row exercising every scalar kind beyond the binary64 and safe-integer range */
const row =
  '{"id":9007199254740993,"counter":18446744073709551615,"weight":1.5,"ratio":0.5,"day":"2024-02-29","time":"12:30:45.5","span":"P1Y2M3DT4H5M6.7S","stamp":"2024-02-29T12:30:45.123456789Z","flag":true,"mode":"fast","tags":["a","b"],"note":null,"fixed":7,"rate":12.50,"big":12345678901234567890}';

/** Row with one member spelled differently */
const variant = (member: string, replacement: string): string =>
  row.replace(
    new RegExp(`"${member}":(?:"[^"]*"|\\[[^\\]]*\\]|[^,}]*)`),
    `"${member}":${replacement}`,
  );

/** Paths and rules of every violation of a modified Row */
const violations = (member: string, replacement: string): unknown => {
  const observation = decode(built, "Row", variant(member, replacement));
  expect(observation.accepted, `${member}=${replacement}`).toBe(false);
  return observation.violations;
};

native(
  "keeps integers beyond the safe range and every scalar spelling through the public codec",
  () => {
    const accepted = decode(built, "Row", row);
    expect(accepted.accepted).toBe(true);
    for (const token of [
      '"id":9007199254740993',
      '"counter":18446744073709551615',
      '"weight":1.5',
      '"ratio":0.5',
      '"day":"2024-02-29"',
      '"time":"12:30:45.5"',
      '"span":"P1Y2M3DT4H5M6.7S"',
      '"stamp":"2024-02-29T12:30:45.123456789Z"',
      '"fixed":7',
      '"note":null',
      '"rate":12.50',
      '"big":12345678901234567890',
    ])
      expect(String(accepted.encoded)).toContain(token);
    for (const binding of ["http", "ipc"] as const)
      expect(decode(built, "Row", row, binding).accepted, binding).toBe(true);
  },
);

native("rejects integers outside their storage and fractional or string integers", () => {
  expect(violations("id", "9223372036854775808")).toEqual([{ path: "/id", rule: "type" }]);
  expect(violations("id", "1.5")).toEqual([{ path: "/id", rule: "type" }]);
  expect(violations("id", '"1"')).toEqual([{ path: "/id", rule: "type" }]);
  expect(violations("counter", "-1")).toMatchObject([{ path: "/counter" }]);
  expect(violations("counter", "18446744073709551616")).toMatchObject([{ path: "/counter" }]);
});

native("rejects impossible calendar dates, clock times and malformed durations", () => {
  expect(violations("day", '"2023-02-29"')).toEqual([{ path: "/day", rule: "format" }]);
  expect(violations("day", '"2024-2-29"')).toEqual([{ path: "/day", rule: "format" }]);
  expect(violations("time", '"24:00:00"')).toEqual([{ path: "/time", rule: "format" }]);
  expect(violations("time", '"12:30"')).toEqual([{ path: "/time", rule: "format" }]);
  expect(violations("span", '"P"')).toEqual([{ path: "/span", rule: "format" }]);
  expect(violations("span", '"1H"')).toEqual([{ path: "/span", rule: "format" }]);
});

native("accepts the week form of a duration and rejects a signed or mixed week", () => {
  expect(decode(built, "Row", variant("span", '"P2W"')).accepted).toBe(true);
  expect(violations("span", '"-P2W"')).toEqual([{ path: "/span", rule: "format" }]);
  expect(violations("span", '"P1Y2W"')).toEqual([{ path: "/span", rule: "format" }]);
});

native("accepts a UTC instant only with a zero offset", () => {
  expect(violations("stamp", '"2024-02-29T12:30:45+01:00"')).toEqual([
    { path: "/stamp", rule: "format" },
  ]);
  expect(decode(built, "Row", variant("stamp", '"2024-02-29T12:30:45+00:00"')).accepted).toBe(true);
  expect(decode(built, "Row", variant("stamp", '"2024-02-29T12:30:45-00:00"')).accepted).toBe(true);
});

native(
  "accepts a binary64 whole number beyond the safe-integer range and returns it unchanged",
  () => {
    const observation = decode(built, "Row", variant("weight", "1e300"));
    expect(observation.accepted).toBe(true);
    const encoded = JSON.parse(String(observation.encoded)) as { weight: number };
    expect(encoded.weight).toBe(1e300);
  },
);

native(
  "rejects values outside enumerations, literals, booleans, floats, strings and nullable members",
  () => {
    expect(violations("mode", '"bogus"')).toEqual([{ path: "/mode", rule: "literal" }]);
    expect(violations("fixed", "8")).toEqual([{ path: "/fixed", rule: "literal" }]);
    expect(violations("flag", '"true"')).toEqual([{ path: "/flag", rule: "type" }]);
    expect(violations("weight", '"1.5"')).toEqual([{ path: "/weight", rule: "type" }]);
    expect(violations("tags", "[1]")).toEqual([{ path: "/tags/0", rule: "type" }]);
    expect(violations("note", "5")).toEqual([{ path: "/note", rule: "type" }]);
    expect(decode(built, "Row", row.replace(',"note":null', "")).violations).toEqual([
      { path: "/note", rule: "required" },
    ]);
  },
);

native("compares decimal and integer bounds exactly whatever the spelling", () => {
  expect(violations("rate", "-0.01")).toEqual([{ path: "/rate", rule: "minimum" }]);
  expect(violations("rate", "100.5000000000000000001")).toEqual([
    { path: "/rate", rule: "maximum" },
  ]);
  expect(violations("rate", "1.0e3")).toEqual([{ path: "/rate", rule: "maximum" }]);
  expect(violations("big", "100000000000000000001")).toEqual([{ path: "/big", rule: "maximum" }]);
  expect(violations("big", "1.5")).toEqual([{ path: "/big", rule: "type" }]);
  for (const rate of ["0", "0.000", "100.5", "100.50", "1.005E+2", "1005e-1"])
    expect(decode(built, "Row", row.replace('"rate":12.50', `"rate":${rate}`)).accepted, rate).toBe(
      true,
    );
});

/** Page with the given number of rows */
const page = (rows: number, next: string): string =>
  `{"rows":[${Array.from({ length: rows }, () => row).join(",")}],"next":${next}}`;

native("enforces array cardinality and nullable bounds on a page", () => {
  expect(decode(built, "Page", page(3, "null")).accepted).toBe(true);
  expect(decode(built, "Page", page(1, "9007199254740993")).encoded).toContain(
    '"next":9007199254740993',
  );
  expect(decode(built, "Page", page(0, "null")).violations).toEqual([
    { path: "/rows", rule: "minItems" },
  ]);
  expect(decode(built, "Page", page(4, "null")).violations).toEqual([
    { path: "/rows", rule: "maxItems" },
  ]);
  expect(decode(built, "Page", page(1, "-1")).violations).toEqual([
    { path: "/next", rule: "minimum" },
  ]);
});
