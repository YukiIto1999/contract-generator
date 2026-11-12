import { LosslessNumber, stringify } from "lossless-json";
import type { Constant, ContractType } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";

/** Open-ended vocabulary of a reference JSON format */
export type JsonObject = Record<string, unknown>;

/** Complete interpreted node index shared by every projection */
export type NodeIndex = ReadonlyMap<string, ContractType>;

/** Meanings not enforced by generic projection consumers */
export const projectionLimitations = [
  "Nominal role identity and immutable accepted-value ownership",
  "Provider-only default completion and unknown-property diagnostics",
  "Typed rejection, defect, cancellation and deadline channels",
  "Exact numeric and lexical guarantees beyond a generic validator's capabilities",
];

/** Exact constant projection without a binary64 round trip
 * @param value - Normalized source constant
 * @returns JSON-compatible reference value
 */
export function constant(value: Constant): unknown {
  switch (value.kind) {
    case "null":
      return null;
    case "string":
    case "boolean":
      return value.value;
    case "number":
      return new LosslessNumber(value.text);
    case "array":
      return value.items.map(constant);
    case "object":
      return Object.fromEntries(
        Object.entries(value.properties)
          .sort(([left], [right]) => compareText(left, right))
          .map(([name, item]) => [name, constant(item)]),
      );
  }
}

/** Stable reference document serialization
 * @param value - Complete reference document
 * @returns Deterministic UTF-8 text
 * @throws {@link Error} The document value is undefined and has no JSON text
 */
export function serialize(value: unknown): string {
  const text = stringify(value, undefined, 2);
  if (text === undefined) throw new Error("A reference document cannot be undefined");
  return text + "\n";
}

/** URI-fragment JSON pointer token
 * @param id - Stable contract node identity
 * @returns Escaped reference segment
 */
export function referenceToken(id: string): string {
  return encodeURIComponent(id.replaceAll("~", "~0").replaceAll("/", "~1"));
}

/** Required normalized node lookup
 * @param types - Complete interpreted node index
 * @param id - Existing node identity
 * @returns Referenced node
 * @throws {@link Error} The identity names no node of the interpreted contract
 */
export function requiredNode(types: NodeIndex, id: string): ContractType {
  const node = types.get(id);
  if (node === undefined) throw new Error("Unresolved normalized contract node: " + id);
  return node;
}
