import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vite-plus/test";
import { runDriver } from "./csharp-process.js";
import { nativeTest, useContract } from "./csharp-suite.js";
import { generatedDiagnostics } from "./csharp-toolchain.js";
import {
  declarations,
  fenceOneLine,
  flavorValues,
  hostileContract,
  lookalikes,
  memberBreaks,
  oneLine,
  pickJson,
  pickTagOneLine,
  specimenJson,
  wireNameOneLine,
} from "./hostile-source.js";

/** Generated contract whose descriptions, wire name, closed values and tag are hostile text */
const contract = useContract(
  "tests/fixtures/csharp/source-data.tsp",
  "SourceData",
  ["SourceDataDriver.csproj"],
  undefined,
  hostileContract("../../../lib/main.tsp"),
);

/** Declarations that C# documents with their description; a closed string set is a plain string there */
const documentedDeclarations = declarations.filter(([label]) => label !== "flavor");

/** Text of every element of the XML documentation that the compiler wrote for the generated types assembly
 * @returns Element texts in file order
 * @throws Error when the compiler wrote no documentation file
 */
function documentation(): readonly string[] {
  const { root } = contract.fixture();
  const file = readdirSync(root, { recursive: true, encoding: "utf8" }).find((path) =>
    path.endsWith("Contract.Types.xml"),
  );
  if (file === undefined) throw new Error("the types assembly has no XML documentation file");
  const xml = readFileSync(join(root, file), "utf8");
  return [...xml.matchAll(/<(summary|param|value)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(
    (match) => match[2] ?? "",
  );
}

/** Documentation texts that begin with a marker
 * @param marker - Beginning of the text
 * @returns Distinct matching texts
 */
function startingWith(marker: string): ReadonlySet<string> {
  return new Set(documentation().filter((text) => text.startsWith(marker)));
}

nativeTest("builds the generated types and the driver without any compiler diagnostic", () => {
  const build = contract.build("SourceDataDriver.csproj");
  expect(build.status, build.output).toBe(0);
  expect(generatedDiagnostics(build), build.output).toEqual([]);
});

nativeTest("documents every description of a declaration on one line", () => {
  for (const [label, kind] of documentedDeclarations)
    expect(startingWith(`${label}-before`), label).toEqual(new Set([oneLine(label, kind)]));
  expect(startingWith("Validated alpha")).toEqual(new Set([`Validated ${pickTagOneLine} variant`]));
});

nativeTest(
  "documents every description of a member on one line, for the property and the parameter",
  () => {
    for (const label of memberBreaks)
      expect(startingWith(`${label}-before`), label).toEqual(new Set([oneLine(label)]));
    expect(startingWith("fence-before")).toEqual(new Set([fenceOneLine]));
    expect(startingWith("Value of the wire")).toEqual(
      new Set([`Value of the ${wireNameOneLine} member`]),
    );
  },
);

nativeTest(
  "accepts each closed value as its contract spells it and rejects its lookalikes",
  async () => {
    const values = Object.entries(flavorValues);
    const observations = await runDriver(contract.driver("SourceDataDriver"), [
      ...values.map(([, value]) => ({ type: "Flavor", payload: JSON.stringify(value) })),
      ...lookalikes.map((value) => ({ type: "Flavor", payload: JSON.stringify(value) })),
    ]);
    values.forEach(([name, value], index) => {
      expect(observations[index]?.accepted, name).toBe(true);
      expect(JSON.parse(String(observations[index]?.encoded)), name).toBe(value);
    });
    lookalikes.forEach((value, index) => {
      const observation = observations[values.length + index];
      expect(observation?.accepted, value).toBe(false);
      expect(observation?.violations, value).toEqual([{ path: "", rule: "literal" }]);
    });
  },
);

nativeTest(
  "round-trips the object with hostile member names and the union with a hostile tag",
  async () => {
    const cases = [
      { type: "Specimen", payload: specimenJson },
      { type: "Pick", payload: pickJson },
      { type: "Pick", payload: '{"kind":"plain"}' },
    ];
    const observations = await runDriver(contract.driver("SourceDataDriver"), cases);
    cases.forEach((entry, index) => {
      expect(observations[index]?.accepted, entry.type).toBe(true);
      expect(JSON.parse(String(observations[index]?.encoded)), entry.type).toEqual(
        JSON.parse(entry.payload),
      );
    });
  },
);
