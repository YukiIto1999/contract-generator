import { expect, test } from "vite-plus/test";
import type { ContractType, TypeUse } from "../model/contract-model.js";
import { hasValue, type DomainState } from "./domain-inhabitation.js";

const origin = { file: "main.tsp", start: 0, end: 1, line: 1, column: 1 };
const declaration = { id: "Public.Value", name: "Value", description: "", origin, exported: true };
const longRun = "a".repeat(16_384);

test.each([
  ["nested repetition", "^(a+)+$"],
  ["overlapping alternation", "^(a|aa)+$"],
])("%s decides constrained literal and enum inhabitation", (_name, pattern) => {
  const reference: TypeUse = {
    id: declaration.id,
    nullable: false,
    constraints: { pattern },
    origin,
  };
  const candidates: readonly (readonly [ContractType, boolean])[] = [
    [{ ...declaration, kind: "literal", value: { kind: "string", value: longRun } }, true],
    [{ ...declaration, kind: "literal", value: { kind: "string", value: `${longRun}!` } }, false],
    [
      {
        ...declaration,
        kind: "enum",
        members: [
          { name: "Rejected", value: { kind: "string", value: `${longRun}!` } },
          { name: "Accepted", value: { kind: "string", value: longRun } },
        ],
      },
      true,
    ],
    [
      {
        ...declaration,
        kind: "enum",
        members: [
          { name: "Rejected", value: { kind: "string", value: `${longRun}!` } },
          { name: "AlsoRejected", value: { kind: "string", value: `${longRun}b` } },
        ],
      },
      false,
    ],
  ];
  for (const [node, expected] of candidates) {
    const state: DomainState = {
      types: new Map([[node.id, node]]),
      roots: new Map([[node.id, reference]]),
      effective: new Map([[reference, reference.constraints]]),
      impossible: new Set(),
      inhabited: new Set(),
    };
    expect(hasValue(state, reference), `${node.kind}: ${String(expected)}`).toBe(expected);
  }
});
