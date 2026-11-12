/** Imports, nominal brands, public value shapes and reader vocabulary shared by every generated declaration */
export const runtimeTypesSource = String.raw`import { Ok, Err, Result } from "ts-results-es";
import { parse, stringify, LosslessNumber, isLosslessNumber, compareLosslessNumber } from "lossless-json";
import { base64, base64url } from "@scure/base";

/** Nominal contract role identity */
declare const role: unique symbol;
/** Immutable declaration identity */
declare const declaration: unique symbol;
/** Exact preservation representation independent of nominal roles */
declare const representation: unique symbol;

/** Location and semantic rule without rejected values */
export interface Violation {
  /** RFC 6901 location of the violating value */
  readonly path: string;
  /** Identity of the violated semantic rule */
  readonly rule: string;
}

/** Unknown property location without unknown values */
export interface Diagnostic {
  /** RFC 6901 location of the object containing the unknown property */
  readonly path: string;
  /** Unescaped unknown property name */
  readonly key: string;
}

/**
 * Entire accepted value with independently owned diagnostics
 * @typeParam T - Completed public contract value
 */
export interface Accepted<T> {
  /** Completed immutable value */
  readonly value: T;
  /** Unknown property observations without their values */
  readonly diagnostics: readonly Diagnostic[];
}

/** Binding-local representation selection */
export type WireBinding = "http" | "ipc";

/** Byte access without a mutable owned alias */
export interface ByteSequence {
  /** Number of bytes */
  readonly length: number;
  /**
   * Indexed byte observation
   * @param index - Zero-based byte position
   * @returns Byte or absent position
   */
  at(index: number): number | undefined;
  /**
   * Explicit independent mutable byte copy
   * @returns Caller-owned copy
   */
  toUint8Array(): Uint8Array<ArrayBuffer>;
}

/** Shared contract mismatch rather than expected remote rejection */
export class ContractDefect extends Error {
  /** Contract failure details without unknown property values */
  readonly violations: readonly Violation[];

  /**
   * Contract mismatch creation
   * @param message - Boundary failure category
   * @param violations - Contract rule failures
   */
  constructor(message: string, violations: readonly Violation[] = []) {
    super(message);
    this.name = "ContractDefect";
    this.violations = violations;
  }
}

/** Host-owned cancellation and deadline without generated timeout policy */
export interface CallContext {
  /** Host cancellation forwarded to every communication */
  readonly signal: AbortSignal;
  /** Absolute wall-clock deadline in epoch milliseconds forwarded to the transport */
  readonly deadlineAt: number;
}

/** Expected inability to get or finish a response */
export interface CommunicationFailure {
  /** Failure classification */
  readonly kind: "communication";
  /** Human-facing cause without received values */
  readonly message: string;
}

/**
 * Codec entrypoints with explicit provider-independent construction
 * @typeParam T - Immutable public value
 */
export interface Codec<T> {
  /**
   * Local acceptance without defaults
   * @param input - Untrusted local candidate
   * @returns Accepted immutable value or applicable violations with same-value pattern checks skipped after cheap failures
   */
  create(input: unknown): Result<Accepted<T>, readonly Violation[]>;
  /**
   * Exact JSON decoding without defaults
   * @param text - Complete JSON document
   * @param binding - Wire interpretation
   * @returns Accepted immutable value or violations
   */
  decode(text: string, binding?: WireBinding): Result<Accepted<T>, readonly Violation[]>;
  /**
   * Binding representation acceptance without defaults
   * @param input - Parsed wire candidate
   * @param binding - Wire interpretation
   * @returns Accepted immutable value or violations
   */
  fromWire(input: unknown, binding?: WireBinding): Result<Accepted<T>, readonly Violation[]>;
  /**
   * Exact JSON encoding after provenance validation
   * @param value - Public value including potentially erased types
   * @param binding - Wire interpretation
   * @returns Exact JSON document or violations
   */
  encode(value: T, binding?: WireBinding): Result<string, readonly Violation[]>;
  /**
   * Validated binding representation without mutable owned aliases
   * @param value - Public value including potentially erased types
   * @param binding - Wire interpretation
   * @returns JSON representation or violations
   */
  toWire(value: T, binding?: WireBinding): Result<unknown, readonly Violation[]>;
}

/** Reader origin separating local values, profile constants and binding interpretation */
type Mode = "local" | "constant" | WireBinding;

/** Per-call validation accumulation */
interface State {
  /** Provider default application to omitted members */
  readonly defaults: boolean;
  /** Violations of the current call */
  readonly violations: Violation[];
  /** Unknown property observations of the current call */
  readonly diagnostics: Diagnostic[];
  /** Composite values on the current read path for cycle rejection */
  readonly active: WeakSet<object>;
}

/**
 * Specialized declaration acceptance
 * @typeParam T - Completed declaration
 * @param value - Untrusted candidate
 * @param path - JSON pointer location of the candidate
 * @param state - Current validation accumulation
 * @param mode - Candidate origin
 * @returns Entire completed value or the invalid sentinel
 */
type Reader<T> = (value: unknown, path: string, state: State, mode: Mode) => T | undefined;

/**
 * Specialized declaration binding representation
 * @typeParam T - Completed declaration
 * @param value - Privately completed value
 * @param binding - Binding interpretation
 * @returns Independent wire representation
 */
type Writer<T> = (value: T, binding: WireBinding) => unknown;

/** Binding-local scalar encodings by binding */
type EncodingTable = Readonly<Partial<Record<WireBinding, string>>>;
`;
