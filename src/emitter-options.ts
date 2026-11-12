import type { Target } from "./model/contract-model.js";

/** Caller-selected generation scope independent of domain ownership */
export interface CompilerOptions {
  /** Fully qualified public TypeSpec namespace */
  readonly namespace: string;
  /** Language outputs required for one successful publication */
  readonly targets: Target[];
  /** Caller-owned module exporting Effect and deferEffect */
  readonly "typescript-effect-module"?: string;
  /** Generated C# namespace with no workstation-specific path */
  readonly "csharp-namespace"?: string;
  /** Generated Rust crate prefix */
  readonly "rust-crate-prefix"?: string;
  /** Read-only comparison against the previously published generation */
  readonly check?: boolean;
}

/** Compiler validation of explicit generation scope */
export const emitterOptionsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["namespace", "targets"],
  properties: {
    namespace: { type: "string", minLength: 1 },
    targets: {
      type: "array",
      minItems: 1,
      uniqueItems: true,
      items: { type: "string", enum: ["typescript", "csharp", "rust"] },
    },
    "typescript-effect-module": { type: "string", minLength: 1, nullable: true },
    "csharp-namespace": { type: "string", minLength: 1, nullable: true },
    "rust-crate-prefix": { type: "string", minLength: 1, nullable: true },
    check: { type: "boolean", nullable: true },
  },
} as const;
