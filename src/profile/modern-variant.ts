import {
  isArrayModelType,
  resolveEncodedName,
  walkPropertiesInherited,
  type Model,
  type ModelProperty,
  type UnionVariant,
} from "@typespec/compiler";
import type { Declaration, Field, TypeUse } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";
import type { CompileState } from "./compile-state.js";
import { literalOf } from "./literals.js";
import { fieldsOf } from "./object-fields.js";
import { declareNode, pascalCase } from "./portable-names.js";

/** Envelope mode and payload field chosen by the compiler for a discriminated union */
export interface VariantWireShape {
  /** Wire discriminator field name */
  readonly discriminator: string;
  /** Compiler-selected envelope mode */
  readonly envelope: "object" | "none";
  /** Compiler-selected wrapped payload field */
  readonly payloadName: string;
}

/**
 * Variant object for a modern discriminated union: the declared model itself when its wire shape already is the variant
 * @param state - Normalization state owning the graph
 * @param variant - Named compiler variant
 * @param union - Containing normalized union declaration
 * @param shape - Compiler-selected wire shape of the union
 * @returns Declared model use, or a synthesized object only where the wire shape differs from every declared model
 */
export function modernVariant(
  state: CompileState,
  variant: UnionVariant,
  union: Declaration,
  shape: VariantWireShape,
): TypeUse {
  const tag = String(variant.name);
  if (
    shape.envelope === "none" &&
    variant.type.kind === "Model" &&
    !isArrayModelType(variant.type)
  ) {
    const declared = declaredDiscriminator(state, variant.type, shape.discriminator);
    if (declared) {
      checkDeclaredDiscriminator(state, declared, tag, shape.discriminator);
      return state.resolvers.use(
        variant.type,
        `${union.id}$${tag}`,
        `${union.name}${pascalCase(tag)}`,
        variant,
      );
    }
  }
  return synthesizedVariant(state, variant, union, tag, shape);
}

/**
 * Object node synthesized because no declared model has the variant wire shape
 * @param state - Normalization state owning the graph
 * @param variant - Named compiler variant
 * @param union - Containing normalized union declaration
 * @param tag - Variant name that is the exact wire tag
 * @param shape - Compiler-selected wire shape of the union
 * @returns Use of the registered synthesized object
 */
function synthesizedVariant(
  state: CompileState,
  variant: UnionVariant,
  union: Declaration,
  tag: string,
  shape: VariantWireShape,
): TypeUse {
  const id = `${union.id}$variant$${tag}`;
  const declaration = declareNode(
    state,
    variant,
    id,
    `${union.name}${pascalCase(tag)}Variant`,
    false,
  );
  const tagField = registerTagField(state, variant, declaration, tag, shape.discriminator);
  const fields = variantFields(state, variant, declaration, tagField, shape);
  state.types.set(id, {
    ...declaration,
    kind: "object",
    fields: [...fields].sort((left, right) => compareText(left.name, right.name)),
  });
  return { id, nullable: false, constraints: {}, origin: state.origin(variant) };
}

/**
 * Literal tag node and the required discriminator field that carries it
 * @param state - Normalization state owning the graph
 * @param variant - Named compiler variant
 * @param owner - Synthesized variant declaration
 * @param tag - Variant name that is the exact wire tag
 * @param discriminator - Wire discriminator field name
 * @returns Required nonnullable discriminator field
 */
function registerTagField(
  state: CompileState,
  variant: UnionVariant,
  owner: Declaration,
  tag: string,
  discriminator: string,
): Field {
  const literalId = `${owner.id}$tag`;
  state.types.set(literalId, {
    ...declareNode(state, variant, literalId, `${owner.name}Tag`, false),
    kind: "literal",
    value: { kind: "string", value: tag },
  });
  return {
    name: discriminator,
    wireName: discriminator,
    description: "",
    type: {
      id: literalId,
      nullable: false,
      constraints: {},
      origin: state.origin(variant),
    },
    optional: false,
    origin: state.origin(variant),
  };
}

/**
 * Fields of a synthesized variant for an envelope or an inline payload
 * @param state - Normalization state owning the graph
 * @param variant - Named compiler variant
 * @param owner - Synthesized variant declaration
 * @param tagField - Required discriminator field
 * @param shape - Compiler-selected wire shape of the union
 * @returns Discriminator field with the wrapped payload or the inlined payload fields
 */
function variantFields(
  state: CompileState,
  variant: UnionVariant,
  owner: Declaration,
  tagField: Field,
  shape: VariantWireShape,
): readonly Field[] {
  if (shape.envelope === "object") {
    if (shape.discriminator === shape.payloadName)
      state.issue(
        "envelope-field-conflict",
        variant,
        "Envelope discriminator and payload field names must be different",
      );
    return [
      tagField,
      {
        name: shape.payloadName,
        wireName: shape.payloadName,
        description: "",
        type: state.resolvers.use(
          variant.type,
          `${owner.id}$payload`,
          `${owner.name}Payload`,
          variant,
        ),
        optional: false,
        origin: state.origin(variant),
      },
    ];
  }
  if (variant.type.kind === "Model" && !isArrayModelType(variant.type))
    return [...fieldsOf(state, variant.type, owner.id, owner.name), tagField];
  state.issue("invalid-variant", variant, "A union without an envelope requires object payloads");
  return [tagField];
}

/**
 * Source property through which a variant model already declares the union discriminator
 * @param state - Normalization state supplying the compiler program
 * @param model - Variant model of a union without an envelope
 * @param discriminator - Wire discriminator field name
 * @returns Declared property by canonical name or wire name, when present
 */
function declaredDiscriminator(
  state: CompileState,
  model: Model,
  discriminator: string,
): ModelProperty | undefined {
  const properties = [...walkPropertiesInherited(model)];
  return (
    properties.find((property) => property.name === discriminator) ??
    properties.find(
      (property) =>
        resolveEncodedName(state.program, property, "application/json") === discriminator,
    )
  );
}

/**
 * Declared discriminator agreement with the variant tag without a second object declaration
 * @param state - Normalization state receiving the failures
 * @param property - Variant model property carrying the discriminator
 * @param tag - Variant name that is the exact wire tag
 * @param discriminator - Wire discriminator field name
 */
function checkDeclaredDiscriminator(
  state: CompileState,
  property: ModelProperty,
  tag: string,
  discriminator: string,
): void {
  const literal = literalOf(state, property.type);
  if (property.optional || literal?.kind !== "string" || literal.value !== tag)
    state.issue(
      "invalid-discriminator",
      property,
      `The explicit discriminator field must be a mandatory string literal equal to its modern union variant name ${JSON.stringify(tag)}`,
    );
  if (resolveEncodedName(state.program, property, "application/json") !== discriminator)
    state.issue(
      "encoded-discriminator",
      property,
      "The discriminator field cannot change its wire name independently of the union metadata",
    );
}
