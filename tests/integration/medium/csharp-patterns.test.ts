import { expect } from "vite-plus/test";
import {
  adversarialCases,
  semanticCases,
  type SemanticCase,
} from "../../../src/model/patterns/semantic-vectors.fixture.js";
import { runDriver } from "./csharp-process.js";
import { nativeTest, useContract } from "./csharp-suite.js";
import { generatedDiagnostics } from "./csharp-toolchain.js";

/** Membership that only UTF-16 spelling can get wrong: pairs at the edges of high-surrogate blocks, complements across the surrogate block, and the engine's size limit */
const utf16Cases: readonly SemanticCase[] = [
  {
    pattern: "^[\\u{1F600}-\\u{1F64F}]+$",
    yes: ["\u{1F600}", "\u{1F64F}", "\u{1F600}\u{1F64F}"],
    no: ["", "\u{1F5FF}", "\u{1F650}", "\u{1F600}x", "\u{1F600}\u{1F650}"],
  },
  {
    pattern: "^[\\u{103FF}-\\u{10400}]$",
    yes: ["\u{103FF}", "\u{10400}"],
    no: ["\u{103FE}", "\u{10401}", "\u{10000}", "\uFFFF"],
  },
  {
    pattern: "^[\\u{10001}-\\u{4FFFF}]$",
    yes: ["\u{10001}", "\u{103FF}", "\u{10400}", "\u{20000}", "\u{4FFFF}"],
    no: ["\u{10000}", "\u{50000}", "\u{10FFFF}", "\uFFFF", "a"],
  },
  {
    pattern: "^[\\u{10000}-\\u{10FFFF}]$",
    yes: ["\u{10000}", "\u{1F600}", "\u{10FFFF}"],
    no: ["", "a", "\uD7FF", "\uE000", "\uFFFF"],
  },
  {
    pattern: "^[^a]$",
    yes: ["b", "\n", "\uD7FF", "\uE000", "\uFFFF", "\u{10000}", "\u{10FFFF}"],
    no: ["a", "", "bb", "\u{1F600}\u{1F600}"],
  },
  {
    pattern: "^[^a][^a]$",
    yes: ["xy", "\u{1F600}x", "x\u{1F600}", "\u{1F600}\u{1F600}"],
    no: ["\u{1F600}", "x", "", "a\u{1F600}"],
  },
  {
    pattern: "^.{3}$",
    yes: ["abc", "\u{1F600}b\u{1F600}"],
    no: ["ab", "abcd", "\u{1F600}\u{1F600}", "a\nb"],
  },
  {
    pattern: "^(?:\\u{1F600}|a)+$",
    yes: ["a\u{1F600}a", "\u{1F600}"],
    no: ["", "\u{1F601}", "ab"],
  },
  {
    pattern: "\\u{1F600}",
    yes: ["a\u{1F600}b", "\u{1F600}"],
    no: ["", "a", "\u{1F601}"],
  },
  {
    pattern: "^.{666}$",
    yes: ["a".repeat(666), "\u{1F600}".repeat(666)],
    no: ["a".repeat(665), "a".repeat(667), "\u{1F600}".repeat(665), "a".repeat(665) + "\n"],
  },
  {
    pattern: "^a{1000}$",
    yes: ["a".repeat(1000)],
    no: ["a".repeat(999), "a".repeat(1001)],
  },
];

/** Linear-time witnesses that a backtracking engine cannot finish, in the form of the shared vector */
const adversarial: readonly SemanticCase[] = adversarialCases.map(({ pattern, yes, no }) => ({
  pattern,
  yes: [yes],
  no: [no],
}));

/** Every case that the contract declares as `Pattern<index>` */
const cases: readonly SemanticCase[] = [...semanticCases, ...utf16Cases, ...adversarial];

/** TypeSpec string literal of a text, which only has to keep backslashes, quotes and the interpolation marker
 * @param text - String value
 * @returns Literal whose value is the text
 */
function literal(text: string): string {
  return JSON.stringify(text).replaceAll("$", "\\$");
}

/** Contract with one text scalar per pattern, and a scalar that bounds length as well as a pair of fields to observe siblings
 * @returns TypeSpec source in the namespace `Patterns`
 */
function contractText(): string {
  return [
    'import "../../../lib/main.tsp";',
    "using ContractGenerator;",
    "namespace Patterns;",
    ...cases.map(
      ({ pattern }, index) =>
        `@pattern(${literal(pattern)}) scalar Pattern${index} extends string;`,
    ),
    '@minLength(3) @pattern("^b+$") scalar Short extends string;',
    '@pattern("^c+$") scalar Other extends string;',
    "model Pair { first: Short; second: Other; }",
  ].join("\n");
}

/** Generated contract whose scalars are observed by their public codec */
const contract = useContract(
  "tests/fixtures/csharp/patterns.tsp",
  "Patterns",
  ["PatternDriver.csproj"],
  undefined,
  contractText(),
);

/** One value offered to one generated boundary, with the membership that the contract declares */
interface Probe {
  /** Position of the declaring case */
  readonly index: number;
  /** Candidate text */
  readonly value: string;
  /** Public entry that receives the candidate */
  readonly api: "decode" | "create";
  /** Whether the pattern admits the value */
  readonly expected: boolean;
}

/** Every value of every case through the JSON entry and through local construction */
const probes: readonly Probe[] = cases.flatMap((entry, index) =>
  [
    ...entry.yes.map((value) => ({ index, value, expected: true })),
    ...entry.no.map((value) => ({ index, value, expected: false })),
  ].flatMap((probe) => (["decode", "create"] as const).map((api) => ({ ...probe, api }))),
);

/** Observations of every probe, taken from one driver process */
let observed: Promise<readonly Record<string, unknown>[]> | undefined;

/** Observation of all probes by one native process
 * @returns One observation per probe in probe order
 */
function observations(): Promise<readonly Record<string, unknown>[]> {
  observed ??= runDriver(
    contract.driver("PatternDriver"),
    probes.map(({ index, value, api }) => ({
      type: `Pattern${index}`,
      api,
      payload: api === "decode" ? JSON.stringify(value) : value,
    })),
  );
  return observed;
}

nativeTest("builds the generated types and the driver without any compiler diagnostic", () => {
  const build = contract.build("PatternDriver.csproj");
  expect(build.status, build.output).toBe(0);
  expect(generatedDiagnostics(build), build.output).toEqual([]);
});

for (const [index, entry] of cases.entries())
  nativeTest(`keeps the membership of ${JSON.stringify(entry.pattern)}`, async () => {
    const seen = await observations();
    probes.forEach((probe, position) => {
      if (probe.index !== index) return;
      const label = `${probe.api} ${JSON.stringify(probe.value.slice(0, 40))}`;
      expect(seen[position]?.accepted, label).toBe(probe.expected);
      if (probe.expected) expect(seen[position]?.value, label).toBe(probe.value);
      else expect(seen[position]?.violations, label).toEqual([{ path: "", rule: "format" }]);
    });
  });

nativeTest("rejects an unpaired surrogate before any pattern sees it", async () => {
  const type = `Pattern${cases.findIndex(({ pattern }) => pattern === "a")}`;
  const observed = await runDriver(contract.driver("PatternDriver"), [
    { type, api: "create", units: [0x61, 0xd83d] },
    { type, api: "create", units: [0xde00, 0x61] },
    { type, api: "create", units: [0x61, 0xd83d, 0xde00] },
  ]);
  expect(observed).toEqual([
    { accepted: false, violations: [{ path: "", rule: "format" }] },
    { accepted: false, violations: [{ path: "", rule: "format" }] },
    { accepted: true, value: "a\u{1F600}" },
  ]);
});

nativeTest(
  "skips the pattern of a value that already broke its length, and keeps its violation",
  async () => {
    const observed = await runDriver(contract.driver("PatternDriver"), [
      { type: "Short", api: "create", payload: "a" },
      { type: "Short", api: "create", payload: "aaa" },
      { type: "Short", api: "create", payload: "bbb" },
    ]);
    expect(observed).toEqual([
      { accepted: false, violations: [{ path: "", rule: "minLength" }] },
      { accepted: false, violations: [{ path: "", rule: "format" }] },
      { accepted: true, value: "bbb" },
    ]);
  },
);

nativeTest("keeps checking the pattern of a sibling field after another field failed", async () => {
  const [observation] = await runDriver(contract.driver("PatternDriver"), [
    { type: "Pair", api: "decode", payload: '{"first":"a","second":"x"}' },
  ]);
  expect(observation?.accepted).toBe(false);
  expect(observation?.violations).toEqual(
    expect.arrayContaining([
      { path: "/first", rule: "minLength" },
      { path: "/second", rule: "format" },
    ]),
  );
  expect(observation?.violations).toHaveLength(2);
});
