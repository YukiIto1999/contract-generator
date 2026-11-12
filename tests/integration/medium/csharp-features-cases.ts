import type { NativeCase } from "./csharp-codec-observation.js";

/** Source token with an unsafe int64, the full uint64 range, a 36-digit integer, a long decimal and a long-fraction offset date-time */
const exactNumbers =
  '{"wide":9007199254740993,"unsigned":18446744073709551615,"integer":900719925474099312345678901234567890,"amount":"12345678901234567890.123456789012345678900","instant":"0000-02-29T12:34:56.1234567890123456789+05:45"}';

/** Exact token spellings that the numeric baseline must retain */
const exactTokens = [
  '"wide":9007199254740993',
  '"unsigned":18446744073709551615',
  '"integer":900719925474099312345678901234567890',
];

/** Numeric baseline with one spelling replaced
 * @param from - Spelling in the baseline
 * @param to - Replacement spelling
 * @returns Payload text
 */
function vary(from: string, to: string): string {
  return exactNumbers.replace(from, to);
}

/** Numbers-boundary request
 * @param payload - Raw JSON
 * @param binding - Wire representation
 * @returns Codec-protocol input
 */
function numbers(payload: string, binding = "http"): Record<string, string> {
  return { type: "Numbers", payload, binding };
}

/** Rejected numeric payload with one violation
 * @param payload - Raw JSON
 * @param path - Expected pointer
 * @param rule - Expected rule
 * @param binding - Wire representation
 * @returns Case
 */
function reject(payload: string, path: string, rule: string, binding = "http"): NativeCase {
  return { input: numbers(payload, binding), accepted: false, violations: [{ path, rule }] };
}

/** Exact-number acceptance expectations of the Numbers contract
 * @returns Accepted cases
 */
function acceptedNumbers(): readonly NativeCase[] {
  const amount = '"amount":"12345678901234567890.123456789012345678900"';
  const bare = '"amount":12345678901234567890.123456789012345678900';
  return [
    {
      input: numbers(exactNumbers),
      accepted: true,
      encoded: exactNumbers,
      encodedContains: [...exactTokens, amount],
    },
    {
      input: numbers(vary(amount, bare), "ipc"),
      accepted: true,
      encodedContains: [...exactTokens, bare],
    },
    {
      input: numbers(vary("9007199254740993", "9223372036854775807")),
      accepted: true,
      encodedContains: ['"wide":9223372036854775807'],
    },
    {
      input: numbers(vary("9007199254740993", "-9223372036854775808")),
      accepted: true,
      encodedContains: ['"wide":-9223372036854775808'],
    },
    {
      input: numbers(vary("900719925474099312345678901234567890", "1e2")),
      accepted: true,
      encodedContains: ['"integer":1e2'],
    },
  ];
}

/** Exact-number rejection expectations of the Numbers contract
 * @returns Rejected cases
 */
function rejectedNumbers(): readonly NativeCase[] {
  const amount = '"amount":"12345678901234567890.123456789012345678900"';
  return [
    reject(vary("9007199254740993", "9223372036854775808"), "/wide", "maximum"),
    reject(vary("9007199254740993", "-9223372036854775809"), "/wide", "minimum"),
    reject(vary("18446744073709551615", "18446744073709551616"), "/unsigned", "maximum"),
    reject(vary("18446744073709551615", "-1"), "/unsigned", "minimum"),
    reject(vary("9007199254740993", "1.5"), "/wide", "format"),
    reject(vary("9007199254740993", '"1"'), "/wide", "type"),
    reject(vary("900719925474099312345678901234567890", "1.5"), "/integer", "format"),
    reject(vary(amount, '"amount":1.5'), "/amount", "type"),
    reject(vary(amount, '"amount":"1.5"'), "/amount", "type", "ipc"),
  ];
}

/** Role expectations of the nonempty customer
 * @returns Cases
 */
function roleCases(): readonly NativeCase[] {
  const customer = (payload: string): Record<string, string> => ({
    type: "NonemptyCustomer",
    payload,
    binding: "http",
  });
  return [
    { input: customer('""'), accepted: false, violations: [{ path: "", rule: "minLength" }] },
    { input: customer('"customer"'), accepted: true, encoded: '"customer"' },
  ];
}

/** Valid complete Kinds wire value */
const validKinds = {
  flag: true,
  ratio: 1.5,
  small: 2.5,
  day: "2024-02-29",
  clock: "23:59:59.123",
  span: "P1DT2H",
  at: "2016-12-31T23:59:60Z",
  mode: "fast",
  fixed: "fixed",
  seven: 7,
  mixed: "a",
  names: ["a"],
  pairs: [{ value: "x" }],
};

/** Kinds-boundary request with members replaced
 * @param change - Replaced members
 * @returns Codec-protocol input
 */
function kinds(change: Record<string, unknown>): Record<string, string> {
  return { type: "Kinds", payload: JSON.stringify({ ...validKinds, ...change }), binding: "http" };
}

/** Rejected Kinds payload with one violation
 * @param change - Replaced members
 * @param path - Expected pointer
 * @param rule - Expected rule
 * @returns Case
 */
function rejectKinds(change: Record<string, unknown>, path: string, rule: string): NativeCase {
  return { input: kinds(change), accepted: false, violations: [{ path, rule }] };
}

/** Accepted Kinds payload that must round-trip
 * @param change - Replaced members
 * @returns Case expecting the same value back
 */
function acceptKinds(change: Record<string, unknown>): NativeCase {
  return {
    input: kinds(change),
    accepted: true,
    encoded: JSON.stringify({ ...validKinds, ...change }),
  };
}

/** Kinds expectations for the closed, temporal and mixed-kind members
 * @returns Cases
 */
function kindsCases(): readonly NativeCase[] {
  return [
    acceptKinds({}),
    acceptKinds({ maybe: null, mode: "slow", flag: false }),
    acceptKinds({ ratio: 1e300 }),
    acceptKinds({ span: "P2W" }),
    acceptKinds({ at: "2024-01-01T00:00:00+00:00" }),
    acceptKinds({ at: "2024-01-01T00:00:00-00:00" }),
    acceptKinds({ mixed: 1 }),
    acceptKinds({ mixed: true }),
    rejectKinds({ flag: "true" }, "/flag", "type"),
    rejectKinds({ ratio: "1.5" }, "/ratio", "type"),
    rejectKinds({ small: 1e39 }, "/small", "format"),
    rejectKinds({ day: "2023-02-29" }, "/day", "format"),
    rejectKinds({ clock: "24:00:00" }, "/clock", "format"),
    rejectKinds({ span: "P" }, "/span", "format"),
    rejectKinds({ span: "P1Y2W" }, "/span", "format"),
    rejectKinds({ span: "-P2W" }, "/span", "format"),
    rejectKinds({ at: "2016-12-31T23:59:59+01:00" }, "/at", "format"),
    rejectKinds({ mode: "medium" }, "/mode", "literal"),
    rejectKinds({ fixed: "other" }, "/fixed", "literal"),
    rejectKinds({ seven: 8 }, "/seven", "literal"),
    rejectKinds({ mixed: "b" }, "/mixed", "literal"),
    rejectKinds({ mixed: 2 }, "/mixed", "literal"),
    rejectKinds({ mixed: false }, "/mixed", "literal"),
    rejectKinds({ mixed: null }, "/mixed", "null"),
    rejectKinds({ mixed: [] }, "/mixed", "literal"),
    rejectKinds({ maybe: 1 }, "/maybe", "type"),
    rejectKinds({ names: ["a", 1] }, "/names/1", "type"),
    rejectKinds({ names: null }, "/names", "null"),
    rejectKinds({ pairs: [{}] }, "/pairs/0/value", "required"),
  ];
}

/** Request merge case of the Merge operation
 * @param body - Request body text
 * @returns Codec-protocol input that merges the placed `id` with the body
 */
function merge(body: string): Record<string, string> {
  return {
    type: "MergeRequest",
    payload: JSON.stringify({ parameters: '{"id":"p"}', body }),
    binding: "http",
  };
}

/** Body-member expectations of the Merge operation
 * @returns Cases for ruling 8
 */
function mergeCases(): readonly NativeCase[] {
  return [
    { input: merge('{"label":"x"}'), accepted: true, encoded: '{"id":"p","label":"x"}' },
    {
      input: merge('{"label":"x","id":"evil"}'),
      accepted: true,
      encoded: '{"id":"p","label":"x"}',
      diagnostics: [{ path: "", key: "id" }],
    },
    { input: merge("{"), accepted: false, violations: [{ path: "", rule: "json" }] },
    { input: merge("[]"), accepted: false, violations: [{ path: "", rule: "type" }] },
    { input: merge("{}"), accepted: false, violations: [{ path: "/label", rule: "required" }] },
  ];
}

/** Contract-derived expectations of the second generated contract
 * @returns Cases for the Features codec driver
 */
export function featuresCodecCases(): readonly NativeCase[] {
  return [
    ...acceptedNumbers(),
    ...rejectedNumbers(),
    ...roleCases(),
    ...kindsCases(),
    ...mergeCases(),
  ];
}
