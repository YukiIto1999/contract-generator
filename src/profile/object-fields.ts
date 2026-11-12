import {
  getDoc,
  getSummary,
  getTypeName,
  isValue,
  resolveEncodedName,
  walkPropertiesInherited,
  type Model,
  type ModelProperty,
} from "@typespec/compiler";
import type { Constant, Field, TypeUse } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";
import { inspectType, isProfileDecorator } from "./annotations.js";
import type { CompileState } from "./compile-state.js";
import { readConstant } from "./constants.js";
import { pascalCase } from "./portable-names.js";

/** Names already taken by earlier fields of one object */
interface TakenNames {
  /** Wire property names in use */
  readonly wire: Set<string>;
  /** Portable names in use after case folding */
  readonly portable: Set<string>;
}

/**
 * Canonical inherited object fields with independent presence and exact defaults
 * @param state - Normalization state owning the graph
 * @param model - Resolved compiler model or operation parameter model
 * @param id - Stable containing graph identity
 * @param name - Stable containing declaration name
 * @returns Canonically ordered fields with source-owned metadata
 */
export function fieldsOf(
  state: CompileState,
  model: Model,
  id: string,
  name: string,
): readonly Field[] {
  const fields: Field[] = [];
  const taken: TakenNames = { wire: new Set(), portable: new Set() };
  const properties = [...walkPropertiesInherited(model)].sort((left, right) =>
    compareText(left.name, right.name),
  );
  for (const property of properties) {
    inspectType(state, property);
    const wireName = resolveEncodedName(state.program, property, "application/json");
    reserveNames(state, property, wireName, taken);
    const use = state.resolvers.use(
      property.type,
      `${id}$${property.name}`,
      `${name}${pascalCase(property.name)}`,
      property,
      property,
    );
    fields.push(fieldOf(state, property, use, wireName));
  }
  return fields;
}

/**
 * Wire and portable name uniqueness across the fields of one object
 * @param state - Normalization state receiving the failures
 * @param property - Source property being added
 * @param wireName - Resolved JSON property name
 * @param taken - Names already used by earlier fields
 */
function reserveNames(
  state: CompileState,
  property: ModelProperty,
  wireName: string,
  taken: TakenNames,
): void {
  if (taken.wire.has(wireName))
    state.issue(
      "duplicate-wire-field",
      property,
      `Multiple object fields use wire name ${JSON.stringify(wireName)}`,
    );
  taken.wire.add(wireName);
  const portable = pascalCase(property.name).toLowerCase();
  if (taken.portable.has(portable))
    state.issue(
      "naming-conflict",
      property,
      `Object fields collide after portable name conversion: ${property.name}`,
    );
  taken.portable.add(portable);
}

/**
 * Field contract with presence, documentation and the provider-only default
 * @param state - Normalization state owning the pending defaults
 * @param property - Source property
 * @param use - Resolved field value
 * @param wireName - Resolved JSON property name
 * @returns Normalized field
 */
function fieldOf(
  state: CompileState,
  property: ModelProperty,
  use: TypeUse,
  wireName: string,
): Field {
  const value = providerDefault(state, property, use);
  return {
    name: property.name,
    wireName,
    description: getDoc(state.program, property) ?? getSummary(state.program, property) ?? "",
    type: use,
    optional: property.optional,
    ...(value === undefined ? {} : { default: value }),
    origin: state.origin(property),
  };
}

/**
 * Provider-only default declared through the profile decorator, queued for validation
 * @param state - Normalization state owning the pending defaults
 * @param property - Source property
 * @param use - Resolved field value the default must satisfy
 * @returns Exact constant as written, or undefined when none is declared or readable
 */
function providerDefault(
  state: CompileState,
  property: ModelProperty,
  use: TypeUse,
): Constant | undefined {
  if (property.defaultValue)
    state.issue(
      "unsupported-default-syntax",
      property,
      "Built-in property defaults are compiler assignment checks; declare the provider-only default with @providerDefault",
      getTypeName(property),
    );
  const application = property.decorators.find(
    (candidate) =>
      candidate.definition?.name === "@providerDefault" && isProfileDecorator(candidate),
  );
  if (!application) return undefined;
  const argument = application.args[0];
  const target = application.node ?? property;
  if (!argument || !isValue(argument.value)) {
    state.issue(
      "invalid-provider-default",
      target,
      "@providerDefault requires a constant value",
      getTypeName(property),
    );
    return undefined;
  }
  if (!property.optional)
    state.issue(
      "required-provider-default",
      target,
      "A provider default applies only when an optional field is omitted",
      getTypeName(property),
    );
  const value = readConstant(state, argument.value, argument.node ?? target, argument.node);
  if (value !== undefined) state.defaults.push({ value, use, target });
  return value;
}
