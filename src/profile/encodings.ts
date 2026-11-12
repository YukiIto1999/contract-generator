import {
  getEncode,
  getTypeName,
  type ModelProperty,
  type Scalar,
  type Type,
} from "@typespec/compiler";
import type { Binding, Encoding, ScalarKind } from "../model/contract-model.js";
import type { CompileState } from "./compile-state.js";
import { stateKeys, type Applied, type BindingEncoding } from "./metadata.js";
import { scalarKind } from "./scalars.js";

/** Both bindings in the stable order used for reporting */
const bindings: readonly Binding[] = ["http", "ipc"];

/** Built-in encoding names that name a binding encoding of the profile vocabulary */
const builtInEncodings: readonly string[] = [
  "string",
  "base64",
  "base64url",
  "rfc3339",
  "unixTimestamp",
  "json",
];

/** Scalar meanings that have no JSON or plain-text spelling of their own */
const encodedOnlyKinds: readonly ScalarKind[] = ["bytes", "offsetDateTime", "utcDateTime"];

/**
 * Applicability of a representation to a scalar meaning
 * @param encoding - Binding-local representation
 * @param kind - Resolved scalar meaning
 * @returns Whether values of the scalar can be written in the representation
 */
function encodingApplies(encoding: Encoding, kind: ScalarKind): boolean {
  switch (encoding) {
    case "json":
    case "string":
      return !encodedOnlyKinds.includes(kind);
    case "base64":
    case "base64url":
      return kind === "bytes";
    case "rfc3339":
      return kind === "offsetDateTime" || kind === "utcDateTime";
    case "unixTimestamp":
      return kind === "utcDateTime";
  }
}

/**
 * Effective scalar representations retained independently for both bindings
 * @param state - Normalization state caching resolved representations
 * @param scalar - Scalar with resolved hierarchy
 * @returns Complete HTTP and IPC representation table
 */
export function encodingsForScalar(
  state: CompileState,
  scalar: Scalar,
): Readonly<Record<Binding, Encoding>> {
  const known = state.scalarEncodings.get(scalar);
  if (known) return known;
  const kind = scalarKind(state, scalar, false);
  const initial: Encoding =
    kind === "bytes"
      ? "base64"
      : kind === "offsetDateTime" || kind === "utcDateTime"
        ? "rfc3339"
        : "json";
  const inherited = scalar.baseScalar
    ? encodingsForScalar(state, scalar.baseScalar)
    : { http: initial, ipc: initial };
  const result = { ...inherited, ...encodingOverrides(state, scalar, kind) };
  state.scalarEncodings.set(scalar, result);
  return result;
}

/**
 * Binding-local overrides with explicit duplicate and applicability diagnostics
 * @param state - Normalization state receiving the failures
 * @param target - Scalar or property receiving encoding metadata
 * @param kind - Resolved scalar meaning at the declaration
 * @returns Only explicitly declared binding overrides
 */
export function encodingOverrides(
  state: CompileState,
  target: Scalar | ModelProperty,
  kind: ScalarKind | undefined,
): Readonly<Partial<Record<Binding, Encoding>>> {
  const result: Partial<Record<Binding, Encoding>> = {};
  const standard = builtInEncoding(state, target);
  if (standard !== undefined) {
    result.http = standard;
    result.ipc = standard;
  }
  for (const [binding, encoding] of declaredEncodings(state, target)) result[binding] = encoding;
  for (const binding of bindings) {
    const encoding = result[binding];
    if (encoding !== undefined && (kind === undefined || !encodingApplies(encoding, kind)))
      state.issue(
        "invalid-binding-encoding",
        target,
        `${binding} encoding ${encoding} is not applicable to ${kind ?? "a nonscalar value"}`,
      );
  }
  return result;
}

/**
 * Representation selected by the compiler built-in encoding decorator
 * @param state - Normalization state receiving the failures
 * @param target - Scalar or property carrying the decorator
 * @returns The representation shared by both bindings, or undefined when none is declared or usable
 */
function builtInEncoding(
  state: CompileState,
  target: Scalar | ModelProperty,
): Encoding | undefined {
  const standard = getEncode(state.program, target);
  if (!standard) return undefined;
  const encoding = standard.encoding ?? "string";
  const storage = encoding === "unixTimestamp" ? "integer" : "string";
  if (!state.program.checker.isStdType(standard.type, storage))
    state.issue(
      "unsupported-encoding-type",
      target,
      `Encoding storage ${getTypeName(standard.type)} adds a width or role that the binding encoding vocabulary cannot retain; use ${storage}`,
      getTypeName(target),
    );
  if (isBindingEncoding(encoding)) return encoding;
  state.issue(
    "unsupported-encoding",
    target,
    `Unsupported built-in encoding ${JSON.stringify(encoding)}`,
  );
  return undefined;
}

/**
 * Narrowing of a compiler encoding name to the profile vocabulary
 * @param name - Encoding name written through the built-in decorator
 * @returns Whether the name is a binding encoding of the profile
 */
function isBindingEncoding(name: string): name is Encoding {
  return builtInEncodings.includes(name);
}

/**
 * Profile encoding declarations with duplicate detection per binding
 * @param state - Normalization state receiving the failures
 * @param target - Scalar or property carrying the declarations
 * @returns Declared binding and representation pairs in declaration order
 */
function declaredEncodings(
  state: CompileState,
  target: Type,
): readonly (readonly [Binding, Encoding])[] {
  const declarations =
    (state.program.stateMap(stateKeys.encodings) as Map<Type, Applied<BindingEncoding>[]>).get(
      target,
    ) ?? [];
  const seen = new Set<Binding>();
  const declared: (readonly [Binding, Encoding])[] = [];
  for (const declaration of declarations) {
    const { binding, encoding } = declaration.value;
    if (seen.has(binding))
      state.issue(
        "duplicate-binding-encoding",
        declaration.target,
        `More than one encoding is declared for ${binding}`,
        getTypeName(target),
      );
    seen.add(binding);
    declared.push([binding, encoding]);
  }
  return declared;
}
