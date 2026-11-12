import type {
  ContractModel,
  ContractType,
  Operation,
  ScalarType,
  TypeUse,
} from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { scalarEncodes } from "./contract-shapes.js";
import { tsdoc } from "./source-text.js";
import { Namer } from "./target-names.js";
import { operationPublicNames } from "./operation-names.js";

/** Use-site reader registered while declarations are generated */
export interface UseEntry {
  /** Resolved reference the reader specializes */
  readonly use: TypeUse;
  /** Private reader function name */
  readonly name: string;
  /** Readable owner stem the reader name derives from */
  readonly owner: string;
}

/** Mutable state of one contract module generation */
export interface ContractContext {
  /** Declarations sorted by stable identity */
  readonly types: readonly ContractType[];
  /** Operations sorted by stable identity */
  readonly operations: readonly Operation[];
  /** Declarations by stable identity */
  readonly byId: ReadonlyMap<string, ContractType>;
  /** Private identifier allocation */
  readonly names: Namer;
  /** Reader function name by declaration identity */
  readonly readers: ReadonlyMap<string, string>;
  /** Writer function name by declaration identity */
  readonly writers: ReadonlyMap<string, string>;
  /** Scalar declarations that some binding writes as Unix seconds */
  readonly unixUses: ReadonlySet<string>;
  /** Declarations from which a provider default is reachable */
  readonly defaultTypes: ReadonlySet<string>;
  /** Declarations whose wire representation depends on the binding encoding */
  readonly bindingTypes: ReadonlySet<string>;
  /** Module-level constant declarations in emission order */
  readonly constants: string[];
  /** Private compiled constant name for each original pattern */
  readonly patterns: Map<string, string>;
  /** Collision-free private name of the optional engine import */
  readonly patternEngine: string;
  /** Use-site readers in registration order */
  readonly uses: UseEntry[];
  /** Registered use-site reader names by reference identity */
  readonly useNames: Map<TypeUse, string>;
}

/**
 * Every type reference a declaration holds
 * @param type - Declaration
 * @returns Field, element and variant references
 */
export function referencesOf(type: ContractType): readonly TypeUse[] {
  switch (type.kind) {
    case "object":
      return type.fields.map((field) => field.type);
    case "array":
      return [type.element];
    case "union":
      return type.variants.map((variant) => variant.type);
    case "scalar":
    case "enum":
    case "literal":
      return [];
  }
}

/**
 * Unix-seconds encoding of a reference
 * @param use - Resolved reference
 * @returns Whether some binding overrides the encoding to Unix seconds
 */
function writesUnix(use: TypeUse): boolean {
  return use.encodings?.http === "unixTimestamp" || use.encodings?.ipc === "unixTimestamp";
}

/**
 * Declarations whose accepted representation depends on a Unix-seconds binding
 * @param types - Sorted declarations
 * @param operations - Sorted operations
 * @returns Identities of scalar declarations referenced or declared with Unix seconds
 */
function unixIdentities(
  types: readonly ContractType[],
  operations: readonly Operation[],
): Set<string> {
  const identities = new Set<string>();
  for (const type of types) {
    if (
      type.kind === "scalar" &&
      (type.encodings.http === "unixTimestamp" || type.encodings.ipc === "unixTimestamp")
    )
      identities.add(type.id);
    for (const use of referencesOf(type)) if (writesUnix(use)) identities.add(use.id);
  }
  for (const operation of operations)
    for (const outcome of operation.outcomes)
      if (outcome.type !== undefined && writesUnix(outcome.type)) identities.add(outcome.type.id);
  return identities;
}

/**
 * Declarations that are seeded or contain a seeded declaration
 * @param types - Declarations
 * @param seeded - Direct membership predicate
 * @returns Fixed point of the predicate over containment
 */
function reaching(
  types: readonly ContractType[],
  seeded: (type: ContractType) => boolean,
): Set<string> {
  const result = new Set(types.filter(seeded).map((type) => type.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const type of types) {
      if (result.has(type.id) || !referencesOf(type).some((use) => result.has(use.id))) continue;
      result.add(type.id);
      changed = true;
    }
  }
  return result;
}

/**
 * Generation state with every private name reserved before any text is produced
 * @param model - Target-named contract
 * @returns Fresh context
 */
export function createContext(model: ContractModel): ContractContext {
  const types = [...model.types].sort((a, b) => compareText(a.id, b.id));
  const operations = [...model.operations].sort((a, b) => compareText(a.id, b.id));
  const names = new Namer([
    ...types.map((type) => type.name),
    ...operations.flatMap(operationPublicNames),
  ]);
  const stem = (name: string): string => name.replace(/^\$/, "");
  return {
    types,
    operations,
    byId: new Map(types.map((type) => [type.id, type])),
    names,
    readers: new Map(types.map((type) => [type.id, names.claim(`read${stem(type.name)}`)])),
    writers: new Map(types.map((type) => [type.id, names.claim(`write${stem(type.name)}`)])),
    unixUses: unixIdentities(types, operations),
    defaultTypes: reaching(
      types,
      (type) => type.kind === "object" && type.fields.some((field) => field.default !== undefined),
    ),
    bindingTypes: reaching(types, (type) => type.kind === "scalar" && scalarEncodes(type.scalar)),
    constants: [],
    patterns: new Map(),
    patternEngine: names.claim("PatternEngine"),
    uses: [],
    useNames: new Map(),
  };
}

/**
 * Module-level constant with a readable derived name
 * @param context - Generation state
 * @param preferred - Preferred identifier
 * @param summary - Purpose of the constant
 * @param expression - Initializer source
 * @param type - Explicit declared type, when the initializer alone does not carry it
 * @returns Allocated constant name
 */
export function declareConstant(
  context: ContractContext,
  preferred: string,
  summary: string,
  expression: string,
  type?: string,
): string {
  const name = context.names.claim(preferred);
  const annotation = type === undefined ? "" : `: ${type}`;
  context.constants.push(`${tsdoc(summary)}\nconst ${name}${annotation} = ${expression};`);
  return name;
}

/**
 * Reader of a reference, registered on first request
 * @param context - Generation state
 * @param use - Resolved reference
 * @param owner - Readable owner stem for the reader name
 * @returns Private reader function name
 */
export function useReaderName(context: ContractContext, use: TypeUse, owner: string): string {
  const existing = context.useNames.get(use);
  if (existing !== undefined) return existing;
  const name = context.names.claim(`read${owner}`);
  context.useNames.set(use, name);
  context.uses.push({ use, name, owner });
  return name;
}

/**
 * Public TypeScript type of a reference
 * @param context - Generation state
 * @param use - Resolved reference
 * @returns Type expression with explicit nullability
 */
export function referenceType(context: ContractContext, use: TypeUse): string {
  return `${context.byId.get(use.id)!.name}${use.nullable ? " | null" : ""}`;
}

/**
 * Exact Unix token retention of a UTC instant declaration
 * @param context - Generation state
 * @param type - Scalar declaration
 * @returns Whether the declaration keeps a source Unix token when some binding writes Unix seconds
 */
export function preservesUnix(context: ContractContext, type: ScalarType): boolean {
  return type.scalar === "utcDateTime" && type.preserveLexical && context.unixUses.has(type.id);
}
