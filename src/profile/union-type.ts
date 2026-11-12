import {
  getDiscriminatedUnion,
  getTypeName,
  isNullType,
  type DiscriminatedUnion,
  type Expression,
  type Union,
  type UnionVariant,
} from "@typespec/compiler";
import type { Declaration, Literal, Variant } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";
import { inspectType } from "./annotations.js";
import type { CompileState } from "./compile-state.js";
import { checkLiteralDuplicates, literalOf, unionExpressions } from "./literals.js";
import { modernVariant } from "./modern-variant.js";
import { checkMemberNames, pascalCase } from "./portable-names.js";

/**
 * Closed union interpretation from compiler-resolved discriminator metadata
 * @param state - Normalization state owning the graph
 * @param type - Resolved compiler union
 * @param declaration - Reserved graph identity
 */
export function unionNode(state: CompileState, type: Union, declaration: Declaration): void {
  if (state.isOutcomes(type)) {
    state.issue(
      "outcomes-as-payload",
      type,
      "An @outcomes union is an operation result path and cannot also be used as a body value",
    );
    return;
  }
  const [modern, diagnostics] = getDiscriminatedUnion(state.program, type);
  diagnostics.forEach((diagnostic) => state.addDiagnostic(diagnostic));
  const expressions = unionExpressions(state, type);
  const entries = orderedEntries(state, type, modern !== undefined, expressions);
  for (const variant of entries) inspectType(state, variant);
  if (!entries.length) {
    emptyUnionNode(state, type, declaration);
    return;
  }
  const literals = entries.map((variant) =>
    literalOf(state, variant.type, expressions.get(variant)),
  );
  if (!modern && literals.every((literal) => literal !== undefined)) {
    literalUnionNode(state, type, declaration, entries, literals);
    return;
  }
  if (!modern) {
    state.issue(
      "missing-discriminator",
      type,
      "A nonliteral payload union requires an explicit built-in discriminator declaration",
    );
    return;
  }
  discriminatedUnionNode(state, type, declaration, modern, entries);
}

/**
 * Variants in canonical order, excluding null for unions that are not discriminated
 * @param state - Normalization state supplying literal interpretation
 * @param type - Resolved compiler union
 * @param discriminated - Whether the union carries discriminated-union metadata
 * @param expressions - Source expressions aligned with the variants
 * @returns Variants sorted by name or by exact literal spelling
 */
function orderedEntries(
  state: CompileState,
  type: Union,
  discriminated: boolean,
  expressions: ReadonlyMap<UnionVariant, Expression>,
): UnionVariant[] {
  const key = (variant: UnionVariant): string =>
    typeof variant.name === "string"
      ? variant.name
      : (JSON.stringify(literalOf(state, variant.type, expressions.get(variant))) ??
        getTypeName(variant.type));
  return [...type.variants.values()]
    .filter((variant) => discriminated || !isNullType(variant.type))
    .sort((left, right) => compareText(key(left), key(right)));
}

/**
 * Node for a union with no permitted value other than possibly null
 * @param state - Normalization state owning the graph
 * @param type - Resolved compiler union
 * @param declaration - Reserved graph identity
 */
function emptyUnionNode(state: CompileState, type: Union, declaration: Declaration): void {
  if ([...type.variants.values()].some((variant) => isNullType(variant.type)))
    state.types.set(declaration.id, { ...declaration, kind: "literal", value: { kind: "null" } });
  else state.issue("empty-domain", type, "A union must contain at least one permitted value");
}

/**
 * Enumeration node for a union whose variants are all exact literals
 * @param state - Normalization state owning the graph
 * @param type - Resolved compiler union
 * @param declaration - Reserved graph identity
 * @param entries - Variants in canonical order
 * @param literals - Exact literal of each variant
 */
function literalUnionNode(
  state: CompileState,
  type: Union,
  declaration: Declaration,
  entries: readonly UnionVariant[],
  literals: readonly (Literal | undefined)[],
): void {
  const members = entries.map((variant, index) => {
    const value = literals[index]!;
    return {
      name:
        typeof variant.name === "string"
          ? pascalCase(variant.name)
          : value.kind === "string"
            ? pascalCase(value.value)
            : `Case${index + 1}`,
      value,
    };
  });
  checkMemberNames(state, members, type);
  checkLiteralDuplicates(state, members, type);
  state.types.set(declaration.id, { ...declaration, kind: "enum", members });
}

/**
 * Closed union node from a union declared with the discriminated-union decorator
 * @param state - Normalization state owning the graph
 * @param type - Resolved compiler union
 * @param declaration - Reserved graph identity
 * @param modern - Compiler discriminated-union metadata
 * @param entries - Variants in canonical order
 */
function discriminatedUnionNode(
  state: CompileState,
  type: Union,
  declaration: Declaration,
  modern: DiscriminatedUnion,
  entries: readonly UnionVariant[],
): void {
  if (modern.defaultVariant)
    state.issue(
      "open-union",
      type,
      "A default union variant would admit unknown tags and is not supported by the closed contract profile",
    );
  const discriminator = modern.options.discriminatorPropertyName;
  const shape = {
    discriminator,
    envelope: modern.options.envelope,
    payloadName: modern.options.envelopePropertyName,
  };
  const variants: Variant[] = [];
  for (const variant of entries) {
    if (typeof variant.name !== "string") {
      state.issue(
        "unnamed-variant",
        variant,
        "Discriminated union variants require explicit names",
      );
      continue;
    }
    variants.push({
      name: pascalCase(variant.name),
      tag: variant.name,
      type: modernVariant(state, variant, declaration, shape),
      origin: state.origin(variant),
    });
  }
  checkMemberNames(state, variants, type);
  state.types.set(declaration.id, { ...declaration, kind: "union", discriminator, variants });
}
