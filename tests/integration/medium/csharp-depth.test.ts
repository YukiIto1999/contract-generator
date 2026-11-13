import { expect } from "vite-plus/test";
import { depthBuild, depthDriver as driver } from "./csharp-depth-fixture.js";
import { runDriver } from "./csharp-process.js";
import { nativeTest } from "./csharp-suite.js";
import { generatedDiagnostics } from "./csharp-toolchain.js";

type Kind = "object" | "array" | "union";
const depths = [64, 128, 1_000, 20_000];
const leaf = "exact-leaf-雪-𝄞-\uFEFF";

function nested(kind: Kind, depth: number, terminal?: string): string {
  switch (kind) {
    case "object":
      return (
        '{"value":"branch","child":'.repeat(depth) +
        (terminal ?? JSON.stringify({ value: leaf })) +
        "}".repeat(depth)
      );
    case "array":
      return "[".repeat(depth) + (terminal ?? "[]") + "]".repeat(depth);
    case "union":
      return (
        '{"kind":"step","next":'.repeat(depth) +
        (terminal ?? JSON.stringify({ kind: "end", value: leaf })) +
        "}".repeat(depth)
      );
  }
}

function summary(kind: Kind, depth: number, value = leaf): Record<string, unknown> {
  return kind === "array" ? { depth, leaf: 0, isDefault: false } : { depth, leaf: value };
}

nativeTest(
  "compiles a real consumer of recursive nominal arrays and generated provider acceptance",
  () => {
    const build = depthBuild();
    expect(
      generatedDiagnostics(build).map((diagnostic) => diagnostic.text),
      build.output,
    ).toEqual([]);
  },
);

nativeTest(
  "preserves equality, hashing and display semantics on 20000-level recursive values",
  async () => {
    const [observation] = await runDriver(driver(), [{ mode: "lifecycle", depth: 20_000 }]);
    expect(observation).toEqual({
      unionSameInstance: true,
      unionSamePayload: true,
      unionDifferentPayload: false,
      unionDifferentVariant: false,
      unionDecodedPayload: false,
      unionHashConsistent: true,
      unionDisplay: true,
      unionCloneDistinct: true,
      unionClonePayload: true,
      unionCloneEqual: true,
      unionCloneHash: true,
      unionCloneDisplay: true,
      objectSameInstance: true,
      objectDifferentInstance: false,
      objectHashConsistent: true,
      objectDisplay: true,
      arrayCopiedStorage: true,
      arrayDifferentStorage: false,
      arrayHashConsistent: true,
      arrayDisplay: true,
    });
  },
);

for (const kind of ["object", "array", "union"] as const) {
  for (const depth of depths) {
    nativeTest(
      `constructs, encodes and decodes ${depth} nested ${kind} levels without losing the leaf`,
      async () => {
        const requests = [
          { mode: "construct", kind, depth, leaf },
          { mode: "decode", kind, payload: nested(kind, depth) },
        ];
        for (const observation of await runDriver(driver(), requests)) {
          expect(observation).toMatchObject({
            accepted: true,
            before: summary(kind, depth),
            after: summary(kind, depth),
            diagnostics: [],
            violations: [],
          });
          expect(typeof observation.encoded).toBe("string");
        }
      },
    );
  }
}

nativeTest(
  "reports an exact 20000-level invalid leaf path and value-free unknown-member diagnostic",
  async () => {
    const depth = 20_000;
    const cases = [
      {
        kind: "object" as const,
        terminal: '{"value":"","a/b~c":{"private":"not-a-diagnostic"}}',
        path: "/child".repeat(depth),
      },
      {
        kind: "union" as const,
        terminal: '{"kind":"end","value":"","a/b~c":{"private":"not-a-diagnostic"}}',
        path: "/next".repeat(depth),
      },
      { kind: "array" as const, terminal: "null", path: "/0".repeat(depth) },
    ];
    const requests = cases.flatMap(({ kind, terminal }) => [
      { mode: "decode", kind, payload: nested(kind, depth, terminal) },
      { mode: "decode", kind, payload: nested(kind, 64) },
    ]);
    const observations = await runDriver(driver(), requests);
    cases.forEach(({ kind, path }, index) => {
      expect(observations[index * 2]).toEqual({
        accepted: false,
        diagnostics: kind === "array" ? [] : [{ path, key: "a/b~c" }],
        violations: [
          {
            path: kind === "array" ? path : `${path}/value`,
            rule: kind === "array" ? "null" : "minLength",
          },
        ],
      });
      expect(observations[index * 2 + 1]).toMatchObject({
        accepted: true,
        after: summary(kind, 64),
      });
    });
  },
);

nativeTest(
  "preserves deep unknown diagnostics on success without exposing or retaining the unknown subtree",
  async () => {
    const depth = 20_000;
    const payload = nested(
      "object",
      depth,
      JSON.stringify({ value: leaf, "a/b~c": { private: "discard" } }),
    );
    const [observation] = await runDriver(driver(), [{ mode: "decode", kind: "object", payload }]);
    expect(observation).toMatchObject({
      accepted: true,
      before: summary("object", depth),
      after: summary("object", depth),
      diagnostics: [{ path: "/child".repeat(depth), key: "a/b~c" }],
      violations: [],
    });
    expect(observation!.encoded).not.toContain("discard");
  },
);

nativeTest(
  "rejects malformed deep tails and every duplicate-property spelling including unknown subtrees",
  async () => {
    const duplicateLeaves = [
      '{"value":"same","value":"same"}',
      '{"value":"first","value":"second"}',
      '{"value":"first","\\u0076alue":"second"}',
      '{"value":"valid","unknown":{"same":1,"same":1}}',
      '{"value":"valid","unknown":{"same":1,"same":2}}',
      '{"value":"valid","unknown":{"same":1,"\\u0073ame":2}}',
    ];
    const payloads = [
      ...duplicateLeaves.map((terminal) => nested("object", 20_000, terminal)),
      nested("object", 20_000).slice(0, -1),
      nested("object", 20_000) + "false",
      nested("array", 20_000).slice(0, -1),
      nested("union", 20_000).slice(0, -1),
    ];
    const requests = payloads.flatMap((payload) => [
      { mode: "decode", kind: "object", payload },
      { mode: "decode", kind: "object", payload: nested("object", 64) },
    ]);
    const observations = await runDriver(driver(), requests);
    payloads.forEach((_, index) => {
      expect(observations[index * 2]).toMatchObject({
        accepted: false,
        violations: [{ path: "", rule: "json" }],
      });
      expect(observations[index * 2 + 1]).toMatchObject({
        accepted: true,
        after: summary("object", 64),
      });
    });
  },
);

nativeTest(
  "rejects text BOM and invalid escaped or literal surrogates even below an unknown member",
  async () => {
    const invalid = [
      '\uFEFF{"value":"valid"}',
      '{"value":"valid","unknown":"\\uD800"}',
      '{"value":"valid","unknown":"\\uDC00"}',
      '{"value":"valid","unknown":{"\\uD800":"x"}}',
      '{"value":"valid","unknown":[{"nested":"\\uD800x"}]}',
      '{"value":"valid","unknown":"\uD800"}',
      '{"value":"valid","unknown":"\uDC00"}',
    ];
    const requests = invalid.flatMap((payload) => [
      {
        mode: "decode",
        kind: "object",
        payloadUnits: Array.from({ length: payload.length }, (_, index) =>
          payload.charCodeAt(index),
        ),
      },
      { mode: "decode", kind: "object", payload: '{"value":"\\uFEFFvalid\\uD834\\uDD1E"}' },
    ]);
    const observations = await runDriver(driver(), requests);
    invalid.forEach((_, index) => {
      expect(observations[index * 2]).toMatchObject({
        accepted: false,
        violations: [{ path: "", rule: "json" }],
      });
      expect(observations[index * 2 + 1]).toMatchObject({
        accepted: true,
        before: summary("object", 0, "\uFEFFvalid𝄞"),
        after: summary("object", 0, "\uFEFFvalid𝄞"),
      });
    });
  },
);

nativeTest(
  "rejects BOM bytes at the actual HTTP acceptance boundary and accepts FEFF within a string",
  async () => {
    const valid = Buffer.from('{"root":{"value":"inside-\uFEFF-string"}}', "utf8");
    const bad = [
      Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), valid]),
      Buffer.concat([
        Buffer.from('{"root":{"value":"'),
        Buffer.from([0xed, 0xa0, 0x80]),
        Buffer.from('"}}'),
      ]),
      Buffer.from('{"root":{"value":"valid","unknown":"\\uD800"}}', "utf8"),
    ];
    const requests = bad.flatMap((body) => [
      { mode: "http", bodyBase64: body.toString("base64") },
      { mode: "http", bodyBase64: valid.toString("base64") },
    ]);
    const observations = await runDriver(driver(), requests);
    bad.forEach((_, index) => {
      expect(observations[index * 2]).toMatchObject({
        accepted: false,
        handlerCalls: 0,
        violations: [{ path: "", rule: "json" }],
      });
      expect(observations[index * 2 + 1]).toEqual({
        accepted: true,
        status: 200,
        leaf: "inside-\uFEFF-string",
        handlerCalls: 1,
      });
    });
  },
);

for (const depth of depths) {
  nativeTest(
    `applies operation defaults across ${depth} levels while preserving explicit null and stable child identity`,
    async () => {
      const [observation] = await runDriver(driver(), [{ mode: "defaults", depth }]);
      expect(observation).toEqual({
        defaults: depth,
        stableIdentity: true,
        nullPreserved: true,
        sourceUnchanged: true,
        dependentDefaults: true,
        dependentSourceUnchanged: true,
        leaf: "leaf",
        nullInputRejected: true,
      });
    },
  );
}

nativeTest("rejects default nominal arrays and owns mutable enumerable input", async () => {
  const [observation] = await runDriver(driver(), [{ mode: "array-guards" }]);
  expect(observation).toEqual({
    defaultRejected: true,
    defaultEncodeRejected: true,
    defaultChildRejected: true,
    nullEnumerableRejected: true,
    ownsInput: true,
    emptyValid: true,
  });
});
