import assert from "node:assert/strict";
import * as fc from "fast-check";
import * as C from "./contract.js";
import type { Check } from "./check.js";
import { accepted, type Values } from "./consumer-fixture.js";

/**
 * Violations of a rejected decode
 * @param text - Complete JSON document
 * @returns Located violations, empty for an accepted document
 */
function decodeViolations(text: string): readonly C.Violation[] {
  const result = C.Envelope.decode(text);
  return result.isErr() ? result.error : [];
}

/**
 * Pure construction, decode and encode guarantees of the public codecs
 * @param fixture - Accepted values and their wire form
 * @returns Named checks without I/O
 */
export function valueChecks(fixture: Values): readonly Check[] {
  const { value, wire } = fixture;
  return [
    [
      "exact-decimal-and-offset-timestamp-survive-decode-and-encode",
      () => {
        assert.equal(wire["amount"], "9007199254740993123456789.123456789012345678900");
        assert.equal(wire["occurredAt"], "0000-02-29T12:34:56.1234567890123456789+05:45");
      },
    ],
    [
      "role-and-label-bounds-reject-by-construction",
      () => {
        assert.equal(C.RequestId.create("not-a-uuid" as C.RequestId).isErr(), true);
        assert.equal(accepted(C.ShortLabel.create("😀😀😀")), "😀😀😀");
        assert.equal(C.ShortLabel.create("😀😀😀😀").isErr(), true);
      },
    ],
    [
      "label-length-counts-code-points-in-construction-and-decode",
      () => {
        fc.assert(
          fc.property(
            fc.array(fc.constantFrom("A", "😀", "𐐀", "\u00e9"), { minLength: 0, maxLength: 5 }),
            (atoms) => {
              const expected = atoms.length >= 1 && atoms.length <= 3;
              assert.equal(C.ShortLabel.create(atoms.join("")).isOk(), expected);
              assert.equal(C.ShortLabel.decode(JSON.stringify(atoms.join(""))).isOk(), expected);
            },
          ),
          { numRuns: 100, seed: 9173 },
        );
      },
    ],
    [
      "leap-second-timestamps-keep-their-spelling",
      () => {
        for (const timestamp of [
          "2016-12-31T23:59:60.1234567890123456789Z",
          "2017-01-01T05:44:60.1234567890123456789+05:45",
        ])
          assert.equal(accepted(C.ExactTimestamp.decode(JSON.stringify(timestamp))), timestamp);
      },
    ],
    [
      "missing-required-nullable-is-a-required-violation",
      () => {
        const missing = { ...wire };
        delete missing["nullableText"];
        assert.ok(
          decodeViolations(JSON.stringify(missing)).some(
            (v) => v.path === "/nullableText" && v.rule === "required",
          ),
        );
      },
    ],
    [
      "optional-null-and-explicit-undefined-follow-presence-rules",
      () => {
        assert.equal(
          C.Envelope.decode(JSON.stringify({ ...wire, optionalText: null })).isErr(),
          true,
        );
        assert.equal(
          C.Envelope.decode(JSON.stringify({ ...wire, optionalNullable: null })).isOk(),
          true,
        );
        assert.equal(C.Envelope.create({ ...value, optionalText: undefined }).isErr(), true);
      },
    ],
    [
      "unknown-member-is-diagnosed-and-never-retained",
      () => {
        const items = [{ kind: "text", text: "😀", secret: { private: "never retain" } }];
        const extra = C.Envelope.decode(JSON.stringify({ ...wire, items }));
        assert.equal(extra.isOk(), true);
        if (extra.isErr()) return;
        assert.deepEqual(extra.value.diagnostics, [{ path: "/items/0", key: "secret" }]);
        const clean = C.Envelope.encode(extra.value.value);
        assert.equal(clean.isOk() && clean.value.includes("never retain"), false);
      },
    ],
    [
      "known-violation-beside-an-unknown-member-is-rejected",
      () => {
        const items = [{ kind: "text", text: "four", secret: 7 }];
        assert.equal(C.Envelope.decode(JSON.stringify({ ...wire, items })).isErr(), true);
      },
    ],
    [
      "unknown-variant-is-rejected",
      () => {
        assert.equal(
          C.Envelope.decode(
            JSON.stringify({ ...wire, items: [{ kind: "unknown", text: "A" }] }),
          ).isErr(),
          true,
        );
      },
    ],
    [
      "erased-binary-inside-a-text-variant-is-rejected",
      () => {
        assert.equal(
          C.Envelope.create({
            ...value,
            items: [{ kind: "text", bytes: new Uint8Array([1]) }],
          }).isErr(),
          true,
        );
      },
    ],
    [
      "accepted-graph-is-independent-of-source-mutation-and-frozen",
      () => {
        const sourceBytes = new Uint8Array([1, 2, 3]);
        const sourceItem = { kind: "binary", bytes: sourceBytes };
        const sourceItems = [sourceItem];
        const owned = accepted(C.Envelope.create({ ...value, items: sourceItems }));
        sourceBytes[0] = 255;
        sourceItem.kind = "other";
        sourceItems.length = 0;
        const binary = owned.items[0]!;
        assert.equal(owned.items.length, 1);
        assert.equal(binary.kind === "binary" && binary.bytes.at(0), 1);
        if (binary.kind === "binary") binary.bytes.toUint8Array()[0] = 250;
        assert.equal(binary.kind === "binary" && binary.bytes.at(0), 1);
        assert.equal(
          Object.isFrozen(owned) && Object.isFrozen(owned.items) && Object.isFrozen(binary),
          true,
        );
        assert.equal(Reflect.set(owned, "count", 99), false);
      },
    ],
    [
      "immutable-children-are-reused-not-copied",
      () => {
        const owned = accepted(C.Envelope.create(value));
        assert.equal(
          accepted(C.Envelope.create({ ...owned, items: owned.items })).items,
          owned.items,
        );
      },
    ],
    [
      "provider-acceptance-fills-an-omitted-default-and-rejects-null-or-out-of-range",
      () => {
        assert.equal(Object.hasOwn(fixture.input, "limit"), false);
        assert.equal(accepted(C.acceptSubmit(fixture.input)).limit, 3);
        for (const limit of [null, undefined, 4])
          assert.equal(C.acceptSubmit({ input: value, limit }).isErr(), true);
      },
    ],
  ];
}
