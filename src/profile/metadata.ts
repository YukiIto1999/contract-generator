import type {
  DiagnosticTarget,
  ModelProperty,
  Operation,
  Program,
  Scalar,
  Type,
} from "@typespec/compiler";
import type { Binding, Encoding } from "../model/contract-model.js";

/** Compiler-resolved decorator arguments with their original application target */
export interface Applied<T> {
  /** Resolved decorator arguments */
  readonly value: T;
  /** Source application rather than the referenced declaration */
  readonly target: DiagnosticTarget;
}

/** Operation profile metadata retained until complete semantic validation */
export interface OperationMetadata {
  /** Explicit mandatory transports */
  readonly publications: Applied<readonly Binding[]>[];
  /** Route declarations including duplicate declarations */
  readonly http: Applied<{
    readonly method: string;
    readonly path: string;
    readonly body?: string;
  }>[];
  /** Explicit nonbody field placements */
  readonly parameters: Applied<{
    readonly parameter: string;
    readonly location: string;
    readonly wireName: string;
  }>[];
  /** Explicit HTTP result selectors */
  readonly httpResults: Applied<{
    readonly outcome: string;
    readonly status: number;
    readonly mediaType?: string;
    readonly headers: Readonly<Record<string, string>>;
  }>[];
  /** Explicit IPC command declarations */
  readonly ipc: Applied<string>[];
  /** Explicit IPC result tags */
  readonly ipcResults: Applied<{ readonly outcome: string; readonly tag: string }>[];
}

/** Binding-local scalar encoding declaration */
export interface BindingEncoding {
  /** Transport whose representation is overridden */
  readonly binding: Binding;
  /** Representation retained independently of nominal role */
  readonly encoding: Encoding;
}

/** Compiler state keys shared by decorators and the semantic compiler across independently loaded module instances */
export const stateKeys = {
  distinct: Symbol.for("@yukiito1999/contract-generator.distinct"),
  outcomes: Symbol.for("@yukiito1999/contract-generator.outcomes"),
  preserveLexical: Symbol.for("@yukiito1999/contract-generator.preserveLexical"),
  operations: Symbol.for("@yukiito1999/contract-generator.operations"),
  encodings: Symbol.for("@yukiito1999/contract-generator.encodings"),
} as const;

/**
 * Operation metadata owned by the current compiler program
 * @param program - Compiler program with isolated decorator state
 * @param operation - Operation receiving the declaration
 * @returns Mutable accumulation record for the operation
 */
export function operationMetadata(program: Program, operation: Operation): OperationMetadata {
  const map = program.stateMap(stateKeys.operations) as Map<Type, OperationMetadata>;
  let metadata = map.get(operation);
  if (!metadata) {
    metadata = {
      publications: [],
      http: [],
      parameters: [],
      httpResults: [],
      ipc: [],
      ipcResults: [],
    };
    map.set(operation, metadata);
  }
  return metadata;
}

/**
 * Explicit encoding declarations without last-writer-wins behavior
 * @param program - Compiler program with isolated decorator state
 * @param target - Scalar or property receiving the declaration
 * @returns Every binding-local declaration for duplicate validation
 */
export function encodingMetadata(
  program: Program,
  target: Scalar | ModelProperty,
): Applied<BindingEncoding>[] {
  const map = program.stateMap(stateKeys.encodings) as Map<Type, Applied<BindingEncoding>[]>;
  let entries = map.get(target);
  if (!entries) {
    entries = [];
    map.set(target, entries);
  }
  return entries;
}
