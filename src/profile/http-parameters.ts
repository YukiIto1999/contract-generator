import type { DiagnosticTarget } from "@typespec/compiler";
import type { HttpParameter } from "../model/binding-model.js";
import type { Field } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";
import type { BindingContext } from "./binding-context.js";
import { headerToken, hasWhitespaceOrControl } from "./http-tokens.js";
import type { OperationMetadata } from "./metadata.js";

/** Placement declaration with its application target */
type PlacementDeclaration = OperationMetadata["parameters"][number];

/** Parameters placed outside the body and the input names they consumed */
export interface CompiledParameters {
  /** Validated placements in canonical order */
  readonly parameters: readonly HttpParameter[];
  /** Input names that have an HTTP placement */
  readonly placed: ReadonlySet<string>;
}

/**
 * Narrowing of a declared placement location to the HTTP vocabulary
 * @param location - Location written by the author
 * @returns Whether the location is path, query or header
 */
function isLocation(location: string): location is HttpParameter["location"] {
  return location === "path" || location === "query" || location === "header";
}

/**
 * Nonbody parameter placements validated against the operation input
 * @param context - Binding context of the operation
 * @returns Valid placements and the names of the inputs they place
 */
export function compileParameters(context: BindingContext): CompiledParameters {
  const { input, issue, metadata, origin } = context;
  const parameters: HttpParameter[] = [];
  const placed = new Set<string>();
  const wirePlacements = new Set<string>();
  const entries = [...metadata.parameters].sort((left, right) =>
    compareText(left.value.parameter, right.value.parameter),
  );
  for (const entry of entries) {
    const { parameter, location } = entry.value;
    const field = input.fields.find((candidate) => candidate.name === parameter);
    if (!field)
      issue(
        "unknown-parameter",
        entry.target,
        `No operation parameter named ${JSON.stringify(parameter)}`,
      );
    if (placed.has(parameter))
      issue(
        "duplicate-parameter-binding",
        entry.target,
        `Parameter ${parameter} has more than one HTTP placement`,
      );
    placed.add(parameter);
    if (!isLocation(location)) {
      issue(
        "invalid-parameter-location",
        entry.target,
        "HTTP parameter location must be path or query or header",
      );
      continue;
    }
    const wireName = checkWireName(context, entry, location, wirePlacements);
    if (field) checkPlacedField(context, entry.target, field, location);
    parameters.push({ parameter, location, wireName, origin: origin(entry.target) });
  }
  return { parameters, placed };
}

/**
 * Wire name validity and uniqueness within the request
 * @param context - Binding context of the operation
 * @param entry - Placement declaration
 * @param location - Valid placement location
 * @param wirePlacements - Location and wire name pairs already used
 * @returns Wire name, lowercased for headers
 */
function checkWireName(
  context: BindingContext,
  entry: PlacementDeclaration,
  location: HttpParameter["location"],
  wirePlacements: Set<string>,
): string {
  const wireName =
    location === "header" ? entry.value.wireName.toLowerCase() : entry.value.wireName;
  if (
    !wireName ||
    hasWhitespaceOrControl(wireName) ||
    (location === "header" && !headerToken.test(wireName))
  )
    context.issue(
      "invalid-parameter-name",
      entry.target,
      "An HTTP wire parameter requires a nonempty name without whitespace or control characters",
    );
  const wireKey = `${location}:${wireName}`;
  if (wirePlacements.has(wireKey))
    context.issue("duplicate-wire-parameter", entry.target, `Multiple inputs map to ${wireKey}`);
  wirePlacements.add(wireKey);
  return wireName;
}

/**
 * Value-domain and presence rules for an input placed outside the body
 * @param context - Binding context of the operation
 * @param target - Placement declaration target
 * @param field - Operation input field being placed
 * @param location - Valid placement location
 */
function checkPlacedField(
  context: BindingContext,
  target: DiagnosticTarget,
  field: Field,
  location: HttpParameter["location"],
): void {
  const type = context.types.get(field.type.id);
  if (type && type.kind !== "scalar" && type.kind !== "literal" && type.kind !== "enum")
    context.issue(
      "nonscalar-http-parameter",
      target,
      `Nonbody parameter ${field.name} must have a primitive value domain`,
    );
  if (location === "path" && field.optional)
    context.issue(
      "optional-path-parameter",
      target,
      `Path parameter ${field.name} must be required`,
    );
  if (field.type.nullable)
    context.issue(
      "nullable-http-parameter",
      target,
      `The ${location} parameter ${field.name} cannot be nullable: null has no wire form outside the body`,
    );
}
