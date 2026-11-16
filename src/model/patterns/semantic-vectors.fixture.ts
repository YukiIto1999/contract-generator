/** Explicit expected membership independent of every production translator */
export interface SemanticCase {
  /** Authored ECMAScript Unicode source */
  readonly pattern: string;
  /** Strings in the declared language */
  readonly yes: readonly string[];
  /** Strings outside the declared language */
  readonly no: readonly string[];
}

/** Finite semantic oracle shared by every generated language, with no native regular expression execution */
export const semanticCases: readonly SemanticCase[] = [
  { pattern: "a", yes: ["ba!"], no: ["", "b"] },
  { pattern: "^a$", yes: ["a"], no: ["a\n", "a\r", "a\u2028", "a\u2029", "ba"] },
  { pattern: "^.$", yes: ["\u{1f600}", "\u0085"], no: ["\n", "\r", "\u2028", "\u2029", ""] },
  { pattern: "^\u{1f600}$", yes: ["\u{1f600}"], no: ["x"] },
  { pattern: "^\\u{1F600}$", yes: ["\u{1f600}"], no: ["x"] },
  { pattern: "^\\uD83D\\uDE00$", yes: ["\u{1f600}"], no: ["x"] },
  { pattern: "^é$", yes: ["é"], no: ["e\u0301"] },
  { pattern: "^\\d+$", yes: ["123"], no: ["١", "a"] },
  { pattern: "^[\\d]+$", yes: ["123"], no: ["١", "a"] },
  { pattern: "^[\\D]$", yes: ["a"], no: ["7"] },
  { pattern: "^\\w+$", yes: ["Az_09"], no: ["é", "\u212a"] },
  { pattern: "^\\W$", yes: ["é", "\u212a"], no: ["a"] },
  {
    pattern: "^\\s$",
    yes: [
      "\u0009",
      "\u000a",
      "\u000b",
      "\u000c",
      "\u000d",
      "\u0020",
      "\u00a0",
      "\u1680",
      "\u2000",
      "\u2001",
      "\u2002",
      "\u2003",
      "\u2004",
      "\u2005",
      "\u2006",
      "\u2007",
      "\u2008",
      "\u2009",
      "\u200a",
      "\u2028",
      "\u2029",
      "\u202f",
      "\u205f",
      "\u3000",
      "\ufeff",
    ],
    no: ["\u0085", "\u180e", "a"],
  },
  { pattern: "^[\\S]$", yes: ["\u0085", "\u180e", "a"], no: ["\u000b", "\ufeff"] },
  { pattern: "^[a&&b]$", yes: ["a", "&", "b"], no: ["c"] },
  { pattern: "^a\\.b$", yes: ["a.b"], no: ["axb"] },
  { pattern: "^(ab|cd){2,3}?$", yes: ["abcd", "abcdab"], no: ["ab", "abcdabcd"] },
  { pattern: "", yes: ["", "x"], no: [] },
  { pattern: "[]", yes: [], no: ["", "x", "\n"] },
  { pattern: "[^]", yes: ["\n", "\u{1f600}"], no: [""] },
  { pattern: "(?:|a)", yes: ["", "x", "a"], no: [] },
  { pattern: "(?<part>a+)", yes: ["ba", "aa"], no: ["b"] },
  { pattern: "^a{01}$", yes: ["a"], no: ["aa", ""] },
  { pattern: "^[^a\\D]$", yes: ["7"], no: ["a", "x"] },
  { pattern: "^[\\D7]$", yes: ["a", "7", "é"], no: ["6"] },
  { pattern: "^[\\d\\D]$", yes: ["a", "7", "\n", "\u{1f600}"], no: [""] },
  { pattern: "^[a-cx-z]$", yes: ["a", "b", "c", "x", "z"], no: ["w", "d"] },
  { pattern: "^[\\b]$", yes: ["\b"], no: ["b", ""] },
  { pattern: "^[]*$", yes: [""], no: ["x"] },
  { pattern: "^[]+$", yes: [], no: ["", "x"] },
  { pattern: "^(?:a|)$", yes: ["", "a"], no: ["b"] },
  { pattern: "^a{0}$", yes: [""], no: ["a"] },
  { pattern: "^[\\uD83D\\uDE00]$", yes: ["\u{1f600}"], no: ["x"] },
];

/** Admitted fixed patterns that a backtracking engine cannot finish on these inputs, with explicit matching and failing witnesses */
export const adversarialCases = [
  { name: "Nested", pattern: "^(a+)+$", yes: "a".repeat(16384), no: "a".repeat(16384) + "!" },
  {
    name: "Overlapping",
    pattern: "^(a|aa)+$",
    yes: "a".repeat(16384),
    no: "a".repeat(16384) + "!",
  },
  { name: "Nullable", pattern: "^(a*)*b$", yes: "a".repeat(16384) + "b", no: "a".repeat(16384) },
  { name: "Unanchored", pattern: "a+a+$", yes: "baaa", no: "a".repeat(16384) + "!" },
] as const;
