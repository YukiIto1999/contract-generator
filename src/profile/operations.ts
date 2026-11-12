import {
  getDoc,
  getSummary,
  getTypeName,
  isErrorModel,
  isNullType,
  isVoidType,
  type Operation as CompilerOperation,
  type Type,
  type UnionVariant,
} from "@typespec/compiler";
import type { ObjectType, Operation, Outcome } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";
import { inspectType } from "./annotations.js";
import { compileBindings } from "./bindings.js";
import type { CompileState } from "./compile-state.js";
import { fieldsOf } from "./object-fields.js";
import {
  checkMemberNames,
  declareNode,
  pascalCase,
  publicName,
  type NamedMember,
} from "./portable-names.js";

/** Result paths of one operation with the authored name of each */
interface OperationOutcomes {
  /** Normalized outcomes in canonical order */
  readonly outcomes: readonly Outcome[];
  /** Authored outcome name mapped to its canonical name */
  readonly outcomeNames: ReadonlyMap<string, string>;
}

/**
 * Complete public operation interpretation with explicit result-path identity
 * @param state - Normalization state owning the graph
 * @param operation - Resolved public compiler operation
 * @returns Normalized operation even while accumulating expected failures
 */
export function operationOf(state: CompileState, operation: CompilerOperation): Operation {
  inspectType(state, operation);
  inspectType(state, operation.parameters);
  const id = getTypeName(operation);
  const name = publicName(state, operation);
  const inputId = `${id}$input`;
  const input: ObjectType = {
    ...declareNode(state, operation, inputId, `${name}Input`, false),
    kind: "object",
    fields: fieldsOf(state, operation.parameters, inputId, `${name}Input`),
  };
  state.types.set(inputId, input);
  const { outcomes, outcomeNames } = outcomesOf(state, operation, id, name);
  const bindings = compileBindings({
    program: state.program,
    operation,
    input,
    outcomes,
    outcomeNames,
    types: state.types,
    origin: (target) => state.origin(target),
    issue: (code, target, reason, subject) => state.issue(code, target, reason, subject ?? id),
  });
  return {
    id,
    name: name[0]!.toLowerCase() + name.slice(1),
    description: getDoc(state.program, operation) ?? getSummary(state.program, operation) ?? "",
    input: inputId,
    outcomes,
    ...bindings,
    origin: state.origin(operation),
  };
}

/**
 * Exhaustive result paths from the operation's outcomes union
 * @param state - Normalization state receiving the failures
 * @param operation - Resolved public compiler operation
 * @param id - Stable operation identity
 * @param name - Portable operation declaration name
 * @returns Normalized outcomes and the authored-to-canonical name table
 */
function outcomesOf(
  state: CompileState,
  operation: CompilerOperation,
  id: string,
  name: string,
): OperationOutcomes {
  const outcomes: Outcome[] = [];
  const members: NamedMember[] = [];
  const outcomeNames = new Map<string, string>();
  const returnType = operation.returnType;
  if (returnType.kind !== "Union" || !returnType.name || !state.isOutcomes(returnType)) {
    state.issue(
      "invalid-outcomes",
      operation,
      "Every public operation must return a named union marked @outcomes",
    );
    return { outcomes, outcomeNames };
  }
  inspectType(state, returnType);
  if (!returnType.variants.size)
    state.issue("empty-domain", returnType, "An operation must declare at least one outcome");
  const variants = [...returnType.variants.values()].sort((left, right) =>
    compareText(String(left.name), String(right.name)),
  );
  for (const variant of variants) {
    inspectType(state, variant);
    if (typeof variant.name !== "string") {
      state.issue(
        "unnamed-outcome",
        variant,
        "Operation outcomes require explicit canonical names",
      );
      continue;
    }
    outcomeNames.set(variant.name, pascalCase(variant.name));
    const outcome = outcomeOf(state, variant, variant.name, id, name);
    outcomes.push(outcome);
    members.push({ name: outcome.name, authored: variant.name });
  }
  checkMemberNames(state, members, returnType);
  return { outcomes, outcomeNames };
}

/**
 * One named result path with its role, payload and documentation
 * @param state - Normalization state receiving the failures
 * @param variant - Named variant of the outcomes union
 * @param authored - Name written by the author
 * @param id - Stable operation identity
 * @param name - Portable operation declaration name
 * @returns Normalized outcome
 */
function outcomeOf(
  state: CompileState,
  variant: UnionVariant,
  authored: string,
  id: string,
  name: string,
): Outcome {
  const outcomeName = pascalCase(authored);
  const { success, rejection } = classifyPayloads(state, variant.type);
  if (success && rejection)
    state.issue(
      "ambiguous-outcome-role",
      variant,
      `Outcome ${authored} cannot combine successful payloads and @error payloads`,
    );
  return {
    name: outcomeName,
    rejection,
    ...(isVoidType(variant.type)
      ? {}
      : {
          type: state.resolvers.use(
            variant.type,
            `${id}$outcome$${authored}`,
            `${name}${outcomeName}`,
            variant,
          ),
        }),
    description: getDoc(state.program, variant) ?? getDoc(state.program, variant.type) ?? "",
    origin: state.origin(variant),
  };
}

/**
 * Success and rejection payloads reachable through nested unions
 * @param state - Normalization state supplying error-model classification
 * @param type - Payload type of one outcome
 * @returns Whether the outcome carries successful payloads and whether it carries declared rejections
 */
function classifyPayloads(
  state: CompileState,
  type: Type,
): { readonly success: boolean; readonly rejection: boolean } {
  const payloads = [type];
  const seen = new Set<Type>();
  let success = false;
  let rejection = false;
  while (payloads.length) {
    const payload = payloads.pop()!;
    if (seen.has(payload)) continue;
    seen.add(payload);
    if (payload.kind === "Union") {
      for (const nested of payload.variants.values())
        if (!isNullType(nested.type)) payloads.push(nested.type);
    } else if (isErrorModel(state.program, payload)) rejection = true;
    else if (!isNullType(payload)) success = true;
  }
  return { success, rejection };
}
