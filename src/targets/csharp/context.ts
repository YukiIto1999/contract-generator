import type {
  ContractModel,
  ContractType,
  EnumType,
  Field,
  Literal,
  ScalarType,
  TypeUse,
} from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { name, pascal, quote } from "./naming.js";

/** Scalar meanings that a lexical-preserving declaration stores as an exact decimal token */
const lexicalNumeric: Readonly<Record<string, true>> = {
  int32: true,
  int64: true,
  uint64: true,
  integer: true,
  float32: true,
  float64: true,
};

/** Member names every generated object class already owns */
const reservedMembers: readonly string[] = [
  "Create",
  "Complete",
  "Equals",
  "GetHashCode",
  "ToString",
  "GetType",
  "MemberwiseClone",
  "Finalize",
];

/** Shared target naming and representation decisions */
export class CSharpContext {
  /** Resolved node lookup */
  readonly nodes: ReadonlyMap<string, ContractType>;
  /** Binding model with deterministic declaration order */
  readonly model: ContractModel;
  /** Escaped generated contract namespace */
  readonly namespace: string;

  /** Context construction
   * @param model - Normalized contract
   * @param csharpNamespace - Caller-selected generated namespace
   */
  constructor(model: ContractModel, csharpNamespace: string) {
    this.model = {
      ...model,
      types: model.types.toSorted((a, b) => compareText(a.id, b.id)),
      operations: model.operations.toSorted((a, b) => compareText(a.id, b.id)),
    };
    this.nodes = new Map(this.model.types.map((t) => [t.id, t]));
    this.namespace = csharpNamespace
      .split(".")
      .map((segment) => name(segment))
      .join(".");
  }

  /** Nested-name-safe generated declaration reference
   * @param identifier - Unescaped top-level declaration name
   * @returns Global namespace-qualified reference
   */
  qualified(identifier: string): string {
    return `global::${this.namespace}.${name(identifier)}`;
  }

  /** Required model node
   * @param id - Canonical node identity
   * @returns Resolved node
   * @throws {@link Error} A normalized contract that references a node it does not contain
   */
  node(id: string): ContractType {
    const node = this.nodes.get(id);
    if (!node) throw new Error(`Missing normalized node ${id}`);
    return node;
  }

  /** Collision-free immutable object property projection
   * @param ownerId - Containing object identity
   * @param fieldName - Canonical field name
   * @returns Escaped property identifier
   * @throws {@link Error} An owner that is not an object node
   */
  property(ownerId: string, fieldName: string): string {
    const owner = this.node(ownerId);
    if (owner.kind !== "object") throw new Error("Property owner must be an object");
    const reserved = new Set([
      owner.name,
      ...reservedMembers,
      ...this.model.operations
        .filter((operation) => operation.input === ownerId)
        .map((operation) => pascal(operation.name) + "AcceptedInput"),
    ]);
    const natural = new Set(owner.fields.map((field) => pascal(field.name)));
    let candidate = pascal(fieldName);
    if (reserved.has(candidate))
      do {
        candidate += "Property";
      } while (reserved.has(candidate) || natural.has(candidate));
    return name(candidate);
  }

  /** Scalar storage representation
   * @param scalar - Scalar meaning
   * @returns C# representation
   */
  storage(scalar: ScalarType): string {
    if (this.preservesLexical(scalar) && lexicalNumeric[scalar.scalar] === true)
      return "ExactDecimal";
    switch (scalar.scalar) {
      case "boolean":
        return "bool";
      case "int32":
        return "int";
      case "int64":
        return "long";
      case "uint64":
        return "ulong";
      case "integer":
      case "decimal":
        return "ExactDecimal";
      case "float32":
        return "float";
      case "float64":
        return "double";
      case "bytes":
        return "ImmutableArray<byte>";
      case "string":
      case "offsetDateTime":
      case "utcDateTime":
      case "plainDate":
      case "plainTime":
      case "duration":
        return "string";
    }
  }

  /** Lexical retention inherited through a nominal role
   * @param scalar - Scalar meaning
   * @returns Whether the source spelling is part of the value
   */
  private preservesLexical(scalar: ScalarType): boolean {
    return (
      scalar.preserveLexical ||
      (scalar.role !== null &&
        this.model.types.some(
          (node) => node.kind === "scalar" && node.role === scalar.role && node.preserveLexical,
        ))
    );
  }

  /** Exact primitive representation
   * @param literal - Literal meaning
   * @returns C# representation
   */
  literal(literal: Literal): string {
    switch (literal.kind) {
      case "boolean":
        return "bool";
      case "number":
        return "ExactDecimal";
      case "string":
      case "null":
        return "string";
    }
  }

  /** Enumeration whose members span several JSON value kinds
   * @param node - Resolved enumeration
   * @returns Whether the enumeration needs a closed case hierarchy instead of one primitive
   */
  isMixedEnum(node: EnumType): boolean {
    return node.members.some((member) => member.value.kind !== node.members[0]?.value.kind);
  }

  /** Node public representation
   * @param id - Canonical identity
   * @returns C# representation
   */
  type(id: string): string {
    const node = this.node(id);
    switch (node.kind) {
      case "scalar":
        return node.role !== null ? this.qualified(this.node(node.role).name) : this.storage(node);
      case "literal":
        return this.literal(node.value);
      case "enum":
        return this.isMixedEnum(node)
          ? this.qualified(node.name)
          : this.literal(node.members[0]!.value);
      case "array":
        return `ImmutableArray<${this.use(node.element)}>`;
      case "object":
      case "union":
        return this.qualified(node.name);
    }
  }

  /** Value representation classification
   * @param id - Canonical identity
   * @returns Whether the public representation is a value type
   */
  valueType(id: string): boolean {
    const t = this.node(id);
    switch (t.kind) {
      case "array":
        return true;
      case "scalar":
        return t.role !== null || this.storage(t) !== "string";
      case "literal":
        return t.value.kind === "boolean" || t.value.kind === "number";
      case "enum": {
        const kind = t.members[0]?.value.kind;
        return !this.isMixedEnum(t) && (kind === "boolean" || kind === "number");
      }
      case "object":
      case "union":
        return false;
    }
  }

  /** Nullable use representation
   * @param use - Resolved type use
   * @returns C# representation
   */
  use(use: TypeUse): string {
    return this.type(use.id) + (use.nullable ? "?" : "");
  }

  /** Field presence representation
   * @param field - Resolved field
   * @param effective - Provider default application state
   * @returns C# representation
   */
  field(field: Field, effective = false): string {
    const t = this.use(field.type);
    return field.optional && !(effective && field.default !== undefined) ? `Presence<${t}>` : t;
  }

  /** Codec declaration identifier
   * @param id - Canonical identity
   * @returns Codec name
   */
  codec(id: string): string {
    return this.qualified(this.node(id).name + "Codec");
  }

  /** Nullable storage extraction
   * @param use - Type use
   * @param expression - Nullable expression
   * @returns Nonnullable expression
   */
  unwrap(use: TypeUse, expression: string): string {
    return use.nullable && this.valueType(use.id) ? `${expression}.Value` : `${expression}!`;
  }

  /** Use-site binding encoding
   * @param use - Type use
   * @returns Runtime encoding expression
   */
  encoding(use: TypeUse): string {
    if (!use.encodings) return "null";
    const select = (encoding: string | undefined): string => (encoding ? quote(encoding) : "null");
    return `(binding == "http" ? ${select(use.encodings.http)} : ${select(use.encodings.ipc)})`;
  }
}
