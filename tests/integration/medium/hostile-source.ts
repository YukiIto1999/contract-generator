/** Statement that fails the build of a generated crate, assembly or project when its text leaves the documentation */
const payload = "compile_error!(injected);";

/** Text that a description breaks at, with what documentation keeps of it: whitespace and line ends become a space, and a character that a comment cannot hold safely is spelled out */
const breaks = {
  crlf: ["\r\n", " "],
  lf: ["\n", " "],
  cr: ["\r", " "],
  nel: ["\u0085", " "],
  ls: ["\u2028", " "],
  ps: ["\u2029", " "],
  vt: ["\v", " "],
  ff: ["\f", " "],
  ctl: ["\u0001", "\\u{0001}"],
  bidi: ["\u202e", "\\u{202E}"],
} as const;

/** Break of each declaration description; a member of the object uses the break of its own name */
export const declarations = [
  ["object", "nel"],
  ["label", "ps"],
  ["flavor", "cr"],
  ["pick", "ls"],
] as const;

/** Names of the object members that each carry one kind of break */
export const memberBreaks = Object.keys(breaks);

/** JSON property name that carries a CRLF, a NEL and a control character */
const wireName = "wire\r\nname\u0085end\u0001";

/** Wire name as the single line that documentation keeps */
export const wireNameOneLine = "wire name end\\u{0001}";

/** Description of the member that holds a fenced code block, which rustdoc would run as a doctest */
const fence = 'fence-before\n```\npanic!("doctest executed");\n```\nfence-after';

/** Fenced description as the single line that C# and TypeScript documentation keep */
export const fenceOneLine = 'fence-before ``` panic!("doctest executed"); ``` fence-after';

/** Closed string values whose spelling is data: escape-like text, controls, direction controls, every C# new-line character and quoting */
export const flavorValues: Readonly<Record<string, string>> = {
  escapedUnicode: "\\u0041",
  controls: "a\bb\fc",
  ctl: "a\u0001b",
  bidi: "a\u202eb",
  nel: "a\u0085b",
  ls: "a\u2028b",
  ps: "a\u2029b",
  quotes: 'say "hi" \\ back',
  crlf: "a\r\nb",
  plain: "plain",
};

/** Values that look like closed values but are none, among them the spellings that a faulty escaper would produce */
export const lookalikes: readonly string[] = ["A", "\\u{0041}", "a b c", "a\nb", "plain "];

/** Discriminator tag with a NEL, a direction control, an LF and the payload */
const pickTag = `alpha\u0085beta\u202e\n${payload}`;

/** Tag as the single line that documentation keeps */
export const pickTagOneLine = `alpha beta\\u{202E} ${payload}`;

/** Description made of two halves joined by a break, then the payload
 * @param label - Marker that identifies the described site
 * @param kind - Name of the break, which is the label for an object member
 * @returns Description before normalization
 */
function description(
  label: string,
  kind: keyof typeof breaks = label as keyof typeof breaks,
): string {
  return `${label}-before${breaks[kind][0]}${label}-after ${payload}`;
}

/** Description as the single line that documentation keeps
 * @param label - Marker that identifies the described site
 * @param kind - Name of the break, which is the label for an object member
 * @returns Normalized description
 */
export function oneLine(
  label: string,
  kind: keyof typeof breaks = label as keyof typeof breaks,
): string {
  return `${label}-before${breaks[kind][1]}${label}-after ${payload}`;
}

/** Complete JSON of an object that carries every member */
export const specimenJson = JSON.stringify(
  Object.fromEntries(
    [...memberBreaks, "fence", wireName].map((name): [string, string] => [name, "x"]),
  ),
);

/** JSON of the union case that carries the hostile tag */
export const pickJson = JSON.stringify({ kind: pickTag, value: "v" });

/** Escapes of the characters that a TypeSpec string literal gives a meaning */
const escapes: Readonly<Record<string, string>> = {
  "\\": "\\\\",
  '"': '\\"',
  $: "\\$",
  "\r": "\\r",
  "\n": "\\n",
};

/** TypeSpec string literal of a text
 * @param text - String value
 * @returns Literal whose value is the text
 */
function literal(text: string): string {
  return `"${text.replace(/[\\"$\r\n]/g, (character) => escapes[character] ?? character)}"`;
}

/** TypeSpec source of a contract whose descriptions, wire name, closed values and discriminator tag are hostile text for generated source
 * @param libraryImport - Import path of the profile library from the compiled source path
 * @returns Contract text in the namespace `SourceData`
 */
export function hostileContract(libraryImport: string): string {
  const fields = [
    ...memberBreaks.map((label) => `  @doc(${literal(description(label))}) ${label}: string;`),
    `  @doc(${literal(fence)}) fence: string;`,
  ];
  const members = Object.entries(flavorValues).map(
    ([name, value]) => `  ${name}: ${literal(value)},`,
  );
  const [objectSite, labelSite, flavorSite, pickSite] = declarations;
  return [
    `import "${libraryImport}";`,
    "using ContractGenerator;",
    "namespace SourceData;",
    `@doc(${literal(description(...labelSite))})`,
    "@distinct",
    "scalar Label extends string;",
    `@doc(${literal(description(...flavorSite))})`,
    "enum Flavor {",
    ...members,
    "}",
    `model Alpha { kind: ${literal(pickTag)}; value: string; }`,
    'model Plain { kind: "plain"; }',
    `@doc(${literal(description(...pickSite))})`,
    '@discriminated(#{ envelope: "none", discriminatorPropertyName: "kind" })',
    `union Pick { ${literal(pickTag)}: Alpha, plain: Plain }`,
    `@doc(${literal(description(...objectSite))})`,
    "model Specimen {",
    ...fields,
    `  @encodedName("application/json", ${literal(wireName)}) bare: string;`,
    "}",
  ].join("\n");
}
