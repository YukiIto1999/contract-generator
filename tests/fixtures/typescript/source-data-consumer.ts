import assert from "node:assert/strict";
import * as C from "./contract.js";
import { runChecks, type Check } from "./check.js";

/** Contract-derived expectations, handed over by the test as one JSON argument */
interface Expected {
  /** Closed values by member name */
  readonly flavorValues: Readonly<Record<string, string>>;
  /** Strings that are no closed value */
  readonly lookalikes: readonly string[];
  /** Complete JSON of the object */
  readonly specimenJson: string;
  /** JSON of the union case with the hostile tag */
  readonly pickJson: string;
}

/** Expectations of this run */
const expected = JSON.parse(process.argv[2] ?? "") as Expected;

/**
 * Wire value after a public decode followed by a public encode
 * @param codec - Generated codec
 * @param text - Complete JSON document
 * @returns Parsed JSON of the encoded value
 * @throws {@link Error} A document that the codec rejects
 */
function roundTrip<T>(codec: C.Codec<T>, text: string): unknown {
  const decoded = codec.decode(text);
  if (decoded.isErr()) throw new Error(JSON.stringify(decoded.error));
  const encoded = codec.encode(decoded.value.value);
  if (encoded.isErr()) throw new Error(JSON.stringify(encoded.error));
  return JSON.parse(encoded.value);
}

/**
 * Guarantees about source text that stays data
 * @returns Named checks without I/O
 */
function sourceDataChecks(): readonly Check[] {
  return [
    [
      "closed-values-keep-their-contract-spelling-through-decode-and-encode",
      () => {
        for (const [name, value] of Object.entries(expected.flavorValues))
          assert.equal(roundTrip(C.Flavor, JSON.stringify(value)), value, name);
      },
    ],
    [
      "closed-value-lookalikes-are-rejected",
      () => {
        for (const lookalike of expected.lookalikes) {
          const result = C.Flavor.decode(JSON.stringify(lookalike));
          assert.deepEqual(result.isErr() && result.error, {
            violations: [{ path: "", rule: "literal" }],
            diagnostics: [],
          });
        }
      },
    ],
    [
      "object-with-hostile-member-names-round-trips",
      () => {
        assert.deepEqual(
          roundTrip(C.Specimen, expected.specimenJson),
          JSON.parse(expected.specimenJson),
        );
      },
    ],
    [
      "union-with-a-hostile-tag-round-trips",
      () => {
        for (const text of [expected.pickJson, '{"kind":"plain"}'])
          assert.deepEqual(roundTrip(C.Pick, text), JSON.parse(text));
      },
    ],
  ];
}

await runChecks(sourceDataChecks(), (line) => process.stdout.write(line + "\n"));
