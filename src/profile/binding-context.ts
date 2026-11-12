import type { DiagnosticTarget, Operation as CompilerOperation, Program } from "@typespec/compiler";
import type { ContractType, ObjectType, Origin, Outcome } from "../model/contract-model.js";
import type { IssueSink } from "./issue-sink.js";
import type { OperationMetadata } from "./metadata.js";

/** Normalized operation facts and services that binding validation consumes */
export interface BindingInput {
  /** Fully checked compiler program */
  readonly program: Program;
  /** Source operation with resolved decorator metadata */
  readonly operation: CompilerOperation;
  /** Normalized operation parameter object */
  readonly input: ObjectType;
  /** Exhaustive normalized result paths */
  readonly outcomes: readonly Outcome[];
  /** Authored result name mapped to its canonical name */
  readonly outcomeNames: ReadonlyMap<string, string>;
  /** Normalized payload graph */
  readonly types: ReadonlyMap<string, ContractType>;
  /** Relative source coordinate resolver */
  readonly origin: (target: DiagnosticTarget) => Origin;
  /** Source-addressed failure accumulator */
  readonly issue: IssueSink;
}

/** Binding input together with the decorator metadata of the operation */
export interface BindingContext extends BindingInput {
  /** Explicit binding declarations accumulated by the profile decorators */
  readonly metadata: OperationMetadata;
}

/** One route declaration with its application target */
export type RouteDeclaration = OperationMetadata["http"][number];

/** One HTTP result declaration with its application target */
export type HttpResultDeclaration = OperationMetadata["httpResults"][number];

/**
 * Authored spelling of a canonical outcome name for diagnostics
 * @param context - Binding context holding the authored-to-canonical table
 * @param canonical - Canonical outcome name
 * @returns Name as the author wrote it, or the canonical name when no authored name maps to it
 */
export function authoredOutcome(context: BindingInput, canonical: string): string {
  for (const [authored, mapped] of context.outcomeNames) if (mapped === canonical) return authored;
  return canonical;
}
