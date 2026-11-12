import {
  getDiscriminatedUnionFromInheritance,
  getDiscriminator,
  isArrayModelType,
  resolveEncodedName,
  walkPropertiesInherited,
  type ArrayModelType,
  type Discriminator,
  type Model,
} from "@typespec/compiler";
import type { Declaration, Variant } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";
import { inspectType } from "./annotations.js";
import type { CompileState } from "./compile-state.js";
import { fieldsOf } from "./object-fields.js";
import { checkMemberNames, pascalCase } from "./portable-names.js";
import { constraintsForModel } from "./scalars.js";

/**
 * Object and array interpretation including inherited property metadata
 * @param state - Normalization state owning the graph
 * @param type - Resolved compiler model
 * @param declaration - Reserved graph identity
 */
export function modelNode(state: CompileState, type: Model, declaration: Declaration): void {
  inspectModelSources(state, type);
  if (isArrayModelType(type)) {
    arrayNode(state, type, declaration);
    return;
  }
  if (type.indexer)
    state.issue(
      "unsupported-indexer",
      type,
      "Open dictionary value domains are not part of the closed-object contract profile",
    );
  const discriminator = getDiscriminator(state.program, type);
  if (discriminator && type.derivedModels.length) {
    inheritedUnionNode(state, type, declaration, discriminator);
    return;
  }
  state.types.set(declaration.id, {
    ...declaration,
    kind: "object",
    fields: fieldsOf(state, type, declaration.id, declaration.name),
  });
}

/**
 * Annotation inspection across the base and source models that contribute members
 * @param state - Normalization state recording inspected declarations
 * @param type - Resolved compiler model
 */
function inspectModelSources(state: CompileState, type: Model): void {
  const pending = [type];
  const seen = new Set<Model>();
  while (pending.length) {
    const source = pending.pop()!;
    if (seen.has(source)) continue;
    seen.add(source);
    inspectType(state, source);
    if (source.baseModel) pending.push(source.baseModel);
    for (const parent of source.sourceModels) pending.push(parent.model);
  }
}

/**
 * Array node with its element use and cardinality restrictions
 * @param state - Normalization state owning the graph
 * @param type - Resolved compiler array model
 * @param declaration - Reserved graph identity
 */
function arrayNode(state: CompileState, type: ArrayModelType, declaration: Declaration): void {
  state.types.set(declaration.id, {
    ...declaration,
    kind: "array",
    element: state.resolvers.use(
      type.indexer.value,
      `${declaration.id}$element`,
      `${declaration.name}Element`,
      type,
    ),
    constraints: constraintsForModel(state, type),
  });
  if ([...walkPropertiesInherited(type)].length)
    state.issue(
      "array-properties",
      type,
      "An array cannot also declare named object fields in this profile",
    );
}

/**
 * Closed union from a model hierarchy with an inherited discriminator
 * @param state - Normalization state owning the graph
 * @param type - Base model carrying the discriminator
 * @param declaration - Reserved graph identity
 * @param discriminator - Compiler discriminator metadata of the base model
 */
function inheritedUnionNode(
  state: CompileState,
  type: Model,
  declaration: Declaration,
  discriminator: Discriminator,
): void {
  const [resolved, diagnostics] = getDiscriminatedUnionFromInheritance(type, discriminator);
  diagnostics.forEach((diagnostic) => state.addDiagnostic(diagnostic));
  const variants: Variant[] = [];
  const tagged = [...resolved.variants].sort(([left], [right]) => compareText(left, right));
  for (const [tag, variant] of tagged) {
    checkInheritedDiscriminator(state, variant, discriminator.propertyName);
    variants.push({
      name: pascalCase(tag),
      tag,
      type: state.resolvers.use(
        variant,
        `${declaration.id}$${tag}`,
        `${declaration.name}${pascalCase(tag)}`,
        variant,
      ),
      origin: state.origin(variant),
    });
  }
  if (!variants.length)
    state.issue("empty-domain", type, "The discriminated model hierarchy has no concrete variants");
  checkMemberNames(state, variants, type);
  state.types.set(declaration.id, {
    ...declaration,
    kind: "union",
    discriminator: discriminator.propertyName,
    variants,
  });
}

/**
 * Wire-name stability of the discriminator field in one derived model
 * @param state - Normalization state receiving the failure
 * @param variant - Derived model of the hierarchy
 * @param propertyName - Discriminator property name of the hierarchy
 */
function checkInheritedDiscriminator(
  state: CompileState,
  variant: Model,
  propertyName: string,
): void {
  const property = [...walkPropertiesInherited(variant)].find(
    (candidate) => candidate.name === propertyName,
  );
  if (property && resolveEncodedName(state.program, property, "application/json") !== propertyName)
    state.issue(
      "encoded-discriminator",
      property,
      "The discriminator field cannot change its wire name independently of the model hierarchy",
    );
}
