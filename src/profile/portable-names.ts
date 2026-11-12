import {
  getDoc,
  getSummary,
  getTypeName,
  type DiagnosticTarget,
  type Type,
} from "@typespec/compiler";
import type { Declaration } from "../model/contract-model.js";
import type { CompileState } from "./compile-state.js";

/**
 * Portable declaration naming without locale-dependent behavior
 * @param name - Compiler identity or source member name
 * @returns PascalCase portable identifier
 */
export function pascalCase(name: string): string {
  const result = name
    .replace(/[^A-Za-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");
  return /^[A-Za-z]/.test(result) ? result : `Value${result}`;
}

/**
 * Stable target declaration name with relative namespace qualification
 * @param state - Normalization state naming the selected namespace
 * @param type - Named compiler declaration
 * @returns Portable contract-wide declaration name
 */
export function publicName(state: CompileState, type: Type): string {
  const identity = getTypeName(type);
  const relative = identity.startsWith(`${state.namespaceName}.`)
    ? identity.slice(state.namespaceName.length + 1)
    : identity;
  return state.program.checker.isStdType(type)
    ? `Intrinsic${pascalCase(relative.replace(/^TypeSpec\./, ""))}`
    : pascalCase(relative);
}

/**
 * Declaration identity with canonical naming conflict detection
 * @param state - Normalization state owning the portable name registry
 * @param type - Compiler declaration responsible for the node
 * @param id - Stable graph identity
 * @param name - Portable target declaration name
 * @param exported - Public declaration rather than an anonymous implementation node
 * @returns Common declaration contract
 */
export function declareNode(
  state: CompileState,
  type: Type,
  id: string,
  name: string,
  exported: boolean,
): Declaration {
  const key = name.toLowerCase();
  const previous = state.names.get(key);
  if (previous && previous !== id)
    state.issue(
      "naming-conflict",
      type,
      `Declarations ${previous} and ${id} both generate the portable name ${name}`,
    );
  state.names.set(key, id);
  return {
    id,
    name,
    description: getDoc(state.program, type) ?? getSummary(state.program, type) ?? "",
    origin: state.origin(type),
    exported,
  };
}

/** Case or variant whose canonical name must stay unique, with its authored spelling when it differs */
export interface NamedMember {
  /** Canonical name before target language escaping */
  readonly name: string;
  /** Spelling written by the author, reported in place of the canonical name when present */
  readonly authored?: string;
}

/**
 * Canonical member-name uniqueness before target language escaping
 * @param state - Normalization state receiving the failures
 * @param members - Canonically named enum cases or variants or outcomes
 * @param target - Containing declaration for diagnostics
 */
export function checkMemberNames(
  state: CompileState,
  members: readonly NamedMember[],
  target: DiagnosticTarget,
): void {
  const names = new Map<string, NamedMember>();
  for (const member of members) {
    const key = member.name.toLowerCase();
    const previous = names.get(key);
    if (previous)
      state.issue(
        "naming-conflict",
        target,
        `Multiple cases generate the portable name ${member.name}: ${previous.authored ?? previous.name} and ${member.authored ?? member.name}`,
      );
    else names.set(key, member);
  }
}
