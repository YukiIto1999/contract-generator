import { expect, test } from "vite-plus/test";
import { prepareDotNetPattern } from "./compiled-pattern.js";
import { semanticCases } from "./semantic-vectors.fixture.js";

/**
 * .NET source of an admitted pattern
 * @param source - Authored ECMAScript Unicode pattern
 * @returns Translated expression for `RegexOptions.NonBacktracking`
 */
function dotnet(source: string): string {
  return prepareDotNetPattern(source).unwrap().source;
}

test.each([
  ["a", String.raw`\u0061`],
  ["^a$", String.raw`\A\u0061\z`],
  ["\u{1f600}", String.raw`\uD83D\uDE00`],
  ["\\u{1F600}", String.raw`\uD83D\uDE00`],
  ["a|", String.raw`\u0061|`],
  ["a*?", String.raw`(?:\u0061)*`],
  ["(?<name>a){2,3}", String.raw`(?:(?:\u0061)){2,3}`],
  ["a{0}", String.raw`(?:\u0061){0}`],
])("%s is spelled over UTF-16 units without lazy quantifiers", (pattern, expected) => {
  expect(dotnet(pattern)).toBe(expected);
});

test.each([
  ["(?:a+|)+", String.raw`(?:(?:(?:(?:\u0061)+)?))+`],
  ["(?:|a)", String.raw`(?:(?:\u0061)?)`],
  ["(?:a|b|)", String.raw`(?:(?:\u0061|\u0062)?)`],
  ["(?:|)", "(?:)"],
  ["()", "(?:)"],
  ["(?:a|b)", String.raw`(?:\u0061|\u0062)`],
])(
  "the empty alternative of %s becomes an optional group, which .NET reduces correctly",
  (pattern, expected) => {
    expect(dotnet(pattern)).toBe(expected);
  },
);

test.each([
  ["\\d", String.raw`[\u0030-\u0039]`],
  ["[]", String.raw`[^\u0000-\uFFFF]`],
  [
    ".",
    String.raw`(?:[\u0000-\u0009\u000B-\u000C\u000E-\u2027\u202A-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])`,
  ],
  [
    "[^a]",
    String.raw`(?:[\u0000-\u0060\u0062-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])`,
  ],
  ["[\\u{1F600}-\\u{1F64F}]", String.raw`\uD83D[\uDE00-\uDE4F]`],
  ["[\\u{103FF}-\\u{10400}]", String.raw`(?:\uD800\uDFFF|\uD801\uDC00)`],
  ["[\\u{10000}-\\u{10FFFF}]", String.raw`[\uD800-\uDBFF][\uDC00-\uDFFF]`],
  ["[\\u{10001}-\\u{4FFFF}]", String.raw`(?:\uD800[\uDC01-\uDFFF]|[\uD801-\uD8FF][\uDC00-\uDFFF])`],
  [
    "[^\\uD7FF\\uE000]",
    String.raw`(?:[\u0000-\uD7FE\uE001-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF])`,
  ],
])("the set %s matches whole code points, never an unpaired surrogate", (pattern, expected) => {
  expect(dotnet(pattern)).toBe(expected);
});

test.each([
  ["a", 2],
  ["^a$", 10],
  ["\u{1f600}", 3],
  ["a*", 2],
  ["a+", 3],
  ["a{5}", 6],
  ["a{2,5}", 6],
  ["a{3,}", 5],
  ["a{0}", 1],
  [".", 4],
  ["[]", 2],
  ["(?:ab|c)d", 5],
  ["^[a-z]{1000}$", 5005],
  ["^a{1000}$", 5005],
  ["a{1000}", 1001],
  ["^.{666}$", 9995],
])("%s has the estimated NonBacktracking size %s", (pattern, size) => {
  expect(prepareDotNetPattern(pattern).unwrap().size).toBe(size);
});

test.each([
  ["^.{1000}$", 15005],
  ["^(?:ab){1000}$", 10005],
  ["^.{667}$", 10010],
])("%s exceeds the .NET limit as the engine itself reports %s nodes", (pattern, size) => {
  const prepared = prepareDotNetPattern(pattern);
  expect(prepared.isErr()).toBe(true);
  if (prepared.isErr()) {
    expect(prepared.error.code).toBe("unsupported-pattern");
    expect(prepared.error.reason).toContain(String(size));
    expect(prepared.error.reason).toContain("10000");
  }
});

test("the common profile still decides what is admitted before .NET is consulted", () => {
  const lookahead = prepareDotNetPattern("(?=a)a");
  expect(lookahead.isErr() && lookahead.error.code).toBe("unsupported-pattern");
  const broken = prepareDotNetPattern("(");
  expect(broken.isErr() && broken.error.code).toBe("invalid-pattern");
  const repeated = prepareDotNetPattern("a{1001}");
  expect(repeated.isErr() && repeated.error.code).toBe("unsupported-pattern");
});

test("every pattern of the shared semantic vector has a .NET translation", () => {
  for (const { pattern } of semanticCases)
    expect(prepareDotNetPattern(pattern).isOk(), JSON.stringify(pattern)).toBe(true);
});
