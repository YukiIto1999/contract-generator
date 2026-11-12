import {
  NoTarget,
  getNamespaceFullName,
  getTypeName,
  type DecoratorFunction,
  type Diagnostic,
  type DiagnosticTarget,
  type ModelProperty,
  type Namespace,
  type Program,
  type Scalar,
  type Type,
} from "@typespec/compiler";
import type {
  Binding,
  Constant,
  Constraints,
  ContractType,
  Encoding,
  GenerationIssue,
  Origin,
  TypeUse,
} from "../model/contract-model.js";
import type { IssueSink } from "./issue-sink.js";
import { stateKeys } from "./metadata.js";
import { createExactNumber, type ExactNumber } from "./numbers.js";
import { originOf, targetAtOrigin } from "./source-origin.js";

/** Recursive resolution entry points that declaration modules call without importing one another */
export interface TypeResolvers {
  /**
   * Resolved type use with nullability independent of property presence
   * @param source - Resolved compiler type at the use site
   * @param path - Stable owner-based identity for anonymous types
   * @param name - Stable target name for anonymous types
   * @param target - Declaration responsible for use-site diagnostics
   * @param property - Optional source property owning local restrictions
   * @returns Compiler-independent graph reference and use-site restrictions
   */
  use(
    source: Type,
    path: string,
    name: string,
    target: DiagnosticTarget,
    property?: ModelProperty,
  ): TypeUse;
  /**
   * Graph node for a compiler-resolved nonnullable value type
   * @param type - Compiler-resolved value type
   * @param path - Stable owner-based anonymous identity
   * @param name - Stable anonymous declaration name
   * @returns Stable normalized graph identity
   */
  node(type: Type, path: string, name: string): string;
}

/** Provider default awaiting validation after every recursive node has been completed */
export interface PendingDefault {
  /** Constant as written by the author */
  readonly value: Constant;
  /** Declared field use the constant must satisfy */
  readonly use: TypeUse;
  /** Decorator application owning the default */
  readonly target: DiagnosticTarget;
}

/** Normalization state isolated to one compile invocation */
export class CompileState {
  /** Failures accumulated before any output */
  readonly issues: GenerationIssue[] = [];
  /** Complete normalized graph keyed by stable source identity */
  readonly types = new Map<string, ContractType>();
  /** Compiler identities already assigned including in-progress recursive models */
  readonly identities = new Map<Type, string>();
  /** Declarations whose semantic annotations have already been checked */
  readonly inspected = new Set<Type>();
  /** Portable target names and their owning source identity */
  readonly names = new Map<string, string>();
  /** Defaults validated only after every recursive node has been completed */
  readonly defaults: PendingDefault[] = [];
  /** Scalar effective restrictions retained across inheritance traversal */
  readonly scalarConstraints = new Map<Scalar, Constraints>();
  /** Scalar wire representations retained independently for both bindings */
  readonly scalarEncodings = new Map<Scalar, Readonly<Record<Binding, Encoding>>>();
  /** Compiler-intrinsic decorator implementations accepted without a declaration */
  readonly intrinsicDecorators = new Set<DecoratorFunction>();
  /** Canonical fully qualified selected namespace */
  readonly namespaceName: string;
  /** Exact numeric spelling recovery for this compiler program */
  readonly exactNumber: ExactNumber;
  /** Recursive resolution entry points */
  readonly resolvers: TypeResolvers;

  /**
   * Compiler normalization state for one selected namespace
   * @param program - Fully checked compiler program
   * @param namespace - Resolved selected namespace when available
   * @param createResolvers - Factory binding the recursive resolution entry points to this state
   */
  constructor(
    readonly program: Program,
    readonly namespace: Namespace | undefined,
    createResolvers: (state: CompileState) => TypeResolvers,
  ) {
    this.namespaceName = namespace ? getNamespaceFullName(namespace) : "";
    this.exactNumber = createExactNumber(program, this.issue);
    this.resolvers = createResolvers(this);
  }

  /**
   * Source-addressed failure accumulation
   * @param code - Stable semantic failure classification
   * @param target - Source declaration or decorator application
   * @param reason - Actionable explanation
   * @param subject - Stable declaration identity when different from source display
   */
  readonly issue: IssueSink = (code, target, reason, subject) => {
    this.issues.push({
      code,
      target: "profile",
      origin: this.origin(target),
      subject: subject ?? this.subject(target),
      reason,
    });
  };

  /**
   * Compiler diagnostic retention as an expected generation failure
   * @param diagnostic - Compiler syntax or semantic failure
   */
  addDiagnostic(diagnostic: Diagnostic): void {
    this.issue(
      `compiler:${diagnostic.code}`,
      diagnostic.target === NoTarget ? this.program.getGlobalNamespaceType() : diagnostic.target,
      diagnostic.message,
    );
  }

  /**
   * Relative declaration coordinates with a selected-source fallback for intrinsics
   * @param target - Source declaration or application
   * @returns Original compiler coordinates independent of absolute checkout root
   */
  origin(target: DiagnosticTarget): Origin {
    return originOf(this.program, this.namespace, target);
  }

  /**
   * Original compiler diagnostic target recovered from normalized coordinates
   * @param origin - Project-relative source location from the private model
   * @returns Original source span or selected namespace for synthetic declarations
   */
  targetAt(origin: Origin): DiagnosticTarget {
    return targetAtOrigin(this.program, this.namespace, origin);
  }

  /**
   * Whether a union is an operation result path rather than a payload value
   * @param type - Compiler type to classify
   * @returns Explicit registration through the outcomes decorator
   */
  isOutcomes(type: Type): boolean {
    return this.program.stateSet(stateKeys.outcomes).has(type);
  }

  /**
   * Human-readable subject from compiler-resolved identity
   * @param target - Source declaration or application
   * @returns Stable source subject without an absolute path
   */
  private subject(target: DiagnosticTarget): string {
    return "entityKind" in target && target.entityKind === "Type"
      ? getTypeName(target as Type)
      : this.namespaceName || "contract";
  }
}
