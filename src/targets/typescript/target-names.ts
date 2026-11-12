import { declaredRuntimeNames } from "./runtime-source.js";

/** Built-in global names referenced by generated code that a contract type must not shadow */
const globalNames: readonly string[] = [
  "AbortSignal",
  "Array",
  "BigInt",
  "Boolean",
  "Error",
  "Map",
  "Math",
  "Number",
  "Object",
  "Partial",
  "Readonly",
  "ReadonlyArray",
  "Record",
  "RegExp",
  "Set",
  "String",
  "SyntaxError",
  "TextDecoder",
  "TypeError",
  "Uint8Array",
  "WeakMap",
  "WeakSet",
];

/** Generated operation type suffixes that a contract type name must not reproduce */
const operationTypeSuffix = /(?:AcceptedInput|Success|Rejection)$/;

/** Names that every generated contract module declares or imports before contract declarations */
const reservedNames: ReadonlySet<string> = new Set([...globalNames, ...declaredRuntimeNames]);

/**
 * TypeScript-safe public declaration name
 * @param name - Portable contract declaration name
 * @returns The name itself or a `$`-prefixed name when it would shadow generated infrastructure
 */
export function publicTypeName(name: string): string {
  return reservedNames.has(name) || operationTypeSuffix.test(name) ? `$${name}` : name;
}

/** Unique-identifier allocation for generated private declarations */
export class Namer {
  private readonly taken: Set<string>;

  /**
   * Allocator seeded with names that are already unavailable
   * @param seed - Runtime, global and public names
   */
  constructor(seed: Iterable<string>) {
    this.taken = new Set([...reservedNames, ...seed]);
  }

  /**
   * Private identifier derived from a preferred name
   * @param preferred - Readable identifier derived from contract text
   * @returns The preferred name or the first numbered variant not yet taken
   */
  claim(preferred: string): string {
    let candidate = preferred;
    for (let attempt = 2; this.taken.has(candidate); attempt++)
      candidate = `${preferred}${attempt}`;
    this.taken.add(candidate);
    return candidate;
  }
}
