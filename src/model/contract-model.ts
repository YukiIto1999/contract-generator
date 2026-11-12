import type { HttpBinding, IpcBinding } from "./binding-model.js";

/** Supported output languages */
export type Target = "typescript" | "csharp" | "rust";

/** Transport interpretations required by a published operation */
export type Binding = "http" | "ipc";

/** Original declaration coordinates independent of an absolute checkout path */
export interface Origin {
  /** Source path relative to the compiler project */
  readonly file: string;
  /** Zero-based source character offset */
  readonly start: number;
  /** Exclusive source character offset */
  readonly end: number;
  /** One-based source line */
  readonly line: number;
  /** One-based source column */
  readonly column: number;
}

/** Exact JSON literal without an intermediate binary64 conversion */
export type Literal =
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "number"; readonly text: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "null" };

/** Constant operation input preserving exact numeric tokens */
export type Constant =
  | Literal
  | { readonly kind: "array"; readonly items: readonly Constant[] }
  | { readonly kind: "object"; readonly properties: Readonly<Record<string, Constant>> };

/** Exact numeric boundary with its own inclusion rule */
export interface Bound {
  /** Exact decimal spelling of the boundary */
  readonly value: string;
  /** Exclusion of the boundary value itself */
  readonly exclusive: boolean;
}

/** Resolved value restrictions with exact numeric bounds */
export interface Constraints {
  /** Numeric lower boundary */
  readonly minimum?: Bound;
  /** Numeric upper boundary */
  readonly maximum?: Bound;
  /** Minimum Unicode code point count */
  readonly minLength?: number;
  /** Maximum Unicode code point count */
  readonly maxLength?: number;
  /** Minimum array element count */
  readonly minItems?: number;
  /** Maximum array element count */
  readonly maxItems?: number;
  /** Interpreted scalar format */
  readonly format?: "uuid";
  /** ECMAScript pattern whose meaning must be retained by every selected output */
  readonly pattern?: string;
}

/** Resolved scalar meanings rather than generator-specific storage types */
export type ScalarKind =
  | "string"
  | "boolean"
  | "int32"
  | "int64"
  | "uint64"
  | "integer"
  | "decimal"
  | "float32"
  | "float64"
  | "bytes"
  | "offsetDateTime"
  | "utcDateTime"
  | "plainDate"
  | "plainTime"
  | "duration";

/** Binding-local scalar representation */
export type Encoding = "json" | "string" | "base64" | "base64url" | "rfc3339" | "unixTimestamp";

/** Reference to a resolved node with use-site restrictions */
export interface TypeUse {
  /** Stable fully qualified node identity */
  readonly id: string;
  /** Explicit null allowance independent of presence */
  readonly nullable: boolean;
  /** Additional use-site restrictions rather than repeated base restrictions */
  readonly constraints: Constraints;
  /** Declaration responsible for this use */
  readonly origin: Origin;
  /** Binding-specific encoding overrides at this use site */
  readonly encodings?: Readonly<Partial<Record<Binding, Encoding>>>;
}

/** Common declaration identity shared by target interpretations */
export interface Declaration {
  /** Stable identity before target-language naming */
  readonly id: string;
  /** Portable PascalCase declaration name unique within the contract */
  readonly name: string;
  /** Human-facing contract documentation from the source declaration */
  readonly description: string;
  /** Original declaration location */
  readonly origin: Origin;
  /** Public declaration rather than an intrinsic scalar */
  readonly exported: boolean;
}

/** Resolved scalar declaration with a role independent of its representation */
export interface ScalarType extends Declaration {
  /** Scalar declaration discriminator */
  readonly kind: "scalar";
  /** Value semantics inherited from the TypeSpec scalar hierarchy */
  readonly scalar: ScalarKind;
  /** Effective nominal role identity with null for an ordinary constrained scalar */
  readonly role: string | null;
  /** Normalized restrictions including inherited restrictions */
  readonly constraints: Constraints;
  /** Effective wire representation for each binding */
  readonly encodings: Readonly<Record<Binding, Encoding>>;
  /** Source spelling required in addition to the value */
  readonly preserveLexical: boolean;
}

/** Object field with presence independent of nullability */
export interface Field {
  /** Canonical field name before language escaping */
  readonly name: string;
  /** Wire property name */
  readonly wireName: string;
  /** Human-facing field contract */
  readonly description: string;
  /** Resolved field value */
  readonly type: TypeUse;
  /** Permission to omit the field */
  readonly optional: boolean;
  /** Constant applied only during provider operation acceptance */
  readonly default?: Constant;
  /** Original field declaration */
  readonly origin: Origin;
}

/** Object shape whose construction owns its invariant */
export interface ObjectType extends Declaration {
  /** Object declaration discriminator */
  readonly kind: "object";
  /** Stable canonical field order */
  readonly fields: readonly Field[];
}

/** Array shape with owned immutable elements */
export interface ArrayType extends Declaration {
  /** Array declaration discriminator */
  readonly kind: "array";
  /** Resolved element value */
  readonly element: TypeUse;
  /** Cardinality restrictions */
  readonly constraints: Constraints;
}

/** One discriminator value and its corresponding payload */
export interface Variant {
  /** Canonical variant name */
  readonly name: string;
  /** Exact string value of the discriminator */
  readonly tag: string;
  /** Resolved object carrying the discriminator */
  readonly type: TypeUse;
  /** Original variant declaration */
  readonly origin: Origin;
}

/** Closed discriminated union without payload guessing */
export interface UnionType extends Declaration {
  /** Union declaration discriminator */
  readonly kind: "union";
  /** Canonical wire property containing the variant tag */
  readonly discriminator: string;
  /** Exhaustive nonoverlapping cases */
  readonly variants: readonly Variant[];
}

/** Closed set of exact primitive values */
export interface EnumType extends Declaration {
  /** Enumeration declaration discriminator */
  readonly kind: "enum";
  /** Named literal cases */
  readonly members: readonly { readonly name: string; readonly value: Literal }[];
}

/** Single permitted primitive value */
export interface LiteralType extends Declaration {
  /** Literal declaration discriminator */
  readonly kind: "literal";
  /** Exact accepted value */
  readonly value: Literal;
}

/** Complete private contract node vocabulary */
export type ContractType = ScalarType | ObjectType | ArrayType | UnionType | EnumType | LiteralType;

/** Named public-operation result independent of its transport representation */
export interface Outcome {
  /** Canonical case name */
  readonly name: string;
  /** Expected rejection rather than a successful return */
  readonly rejection: boolean;
  /** Result payload absent only for a void result */
  readonly type?: TypeUse;
  /** Source result documentation */
  readonly description: string;
  /** Original result declaration */
  readonly origin: Origin;
}

/** Public operation with independently interpreted communication bindings */
export interface Operation {
  /** Stable fully qualified operation identity */
  readonly id: string;
  /** Portable camelCase operation name */
  readonly name: string;
  /** Source operation documentation */
  readonly description: string;
  /** Generated object node containing the operation parameters */
  readonly input: string;
  /** Exhaustive canonical results */
  readonly outcomes: readonly Outcome[];
  /** HTTP interpretation present exactly when the operation is published over HTTP */
  readonly http?: HttpBinding;
  /** IPC interpretation present exactly when the operation is published over IPC */
  readonly ipc?: IpcBinding;
  /** Original operation declaration */
  readonly origin: Origin;
}

/** Compiler-independent interpretation consumed only by internal emitters */
export interface ContractModel {
  /** Selected public namespace independent of business contexts */
  readonly namespace: string;
  /** Portable public contract name */
  readonly name: string;
  /** Nodes sorted by stable identity */
  readonly types: readonly ContractType[];
  /** Operations sorted by stable identity */
  readonly operations: readonly Operation[];
}

/** User-owned language integration without runtime policy defaults */
export interface EmissionOptions {
  /** Mandatory language outputs */
  readonly targets: readonly Target[];
  /** TypeScript module exporting the caller-owned Effect type and deferEffect factory when configured */
  readonly typescriptEffectModule: string | undefined;
  /** Root namespace for generated C# declarations */
  readonly csharpNamespace: string;
  /** Prefix for generated Rust dependency units */
  readonly rustCratePrefix: string;
}

/** Generated artifact retained privately until every target succeeds */
export interface GeneratedFile {
  /** Safe relative path within the emitter-owned output directory */
  readonly path: string;
  /** Deterministic UTF-8 file content */
  readonly content: string;
}

/** Source-addressed failure to preserve a required contract meaning */
export interface GenerationIssue {
  /** Stable diagnostic classification */
  readonly code: string;
  /** Language output or shared interpretation responsible for rejection */
  readonly target: Target | "profile";
  /** Original declaration location */
  readonly origin: Origin;
  /** Contract member whose meaning cannot be retained */
  readonly subject: string;
  /** Actionable explanation of the missing or inconsistent meaning */
  readonly reason: string;
}
