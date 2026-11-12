import {
  getNamespaceFullName,
  getTypeName,
  type DecoratorApplication,
  type Type,
} from "@typespec/compiler";
import type { CompileState } from "./compile-state.js";
import { $decorators } from "./library.js";

/** Declared profile decorators recognized by compiler declaration rather than by loaded module instance */
const profileDecoratorNames: ReadonlySet<string> = new Set(
  Object.keys($decorators.ContractGenerator).map((name) => `@${name}`),
);

/** Explicitly registered compiler semantics and explanatory annotations */
const supportedStandardDecorators: Readonly<Record<string, true>> = {
  "@doc": true,
  "@summary": true,
  "@returnsDoc": true,
  "@errorsDoc": true,
  "@tag": true,
  "@example": true,
  "@opExample": true,
  "@minValue": true,
  "@maxValue": true,
  "@minValueExclusive": true,
  "@maxValueExclusive": true,
  "@minLength": true,
  "@maxLength": true,
  "@minItems": true,
  "@maxItems": true,
  "@format": true,
  "@pattern": true,
  "@encode": true,
  "@encodedName": true,
  "@discriminator": true,
  "@discriminated": true,
  "@error": true,
  "@indexer": true,
  "@withOptionalProperties": true,
  "@withoutOmittedProperties": true,
  "@withPickedProperties": true,
  "@withoutDefaultValues": true,
};

/**
 * Profile decorator identity independent of which module instance the compiler loaded
 * @param application - Decorator application resolved by the compiler
 * @returns Whether the application names a ContractGenerator declaration registered by this profile
 */
export function isProfileDecorator(application: DecoratorApplication): boolean {
  const definition = application.definition;
  return (
    definition !== undefined &&
    getNamespaceFullName(definition.namespace) === "ContractGenerator" &&
    profileDecoratorNames.has(definition.name)
  );
}

/**
 * Explicit annotation registration across every reached declaration
 * @param state - Normalization state recording inspected declarations and failures
 * @param type - Compiler declaration whose semantics affect output
 */
export function inspectType(state: CompileState, type: Type): void {
  if (state.inspected.has(type)) return;
  state.inspected.add(type);
  for (const directive of type.node?.directives ?? []) {
    if (directive.target.sv !== "suppress")
      state.issue(
        "unsupported-directive",
        directive,
        `Unregistered semantic directive #${directive.target.sv}`,
      );
  }
  if (!("decorators" in type)) return;
  for (const application of type.decorators) inspectDecorator(state, type, application);
}

/**
 * Registration check for one decorator application
 * @param state - Normalization state receiving the failures
 * @param type - Declaration carrying the application
 * @param application - Decorator application resolved by the compiler
 */
function inspectDecorator(
  state: CompileState,
  type: Type,
  application: DecoratorApplication,
): void {
  if (isProfileDecorator(application) || state.intrinsicDecorators.has(application.decorator))
    return;
  const definition = application.definition;
  if (!definition && !application.node && application.decorator.name === "docFromCommentDecorator")
    return;
  if (
    definition &&
    getNamespaceFullName(definition.namespace) === "TypeSpec" &&
    supportedStandardDecorators[definition.name]
  ) {
    checkEncodedName(state, type, application);
    return;
  }
  if (state.program.checker.isStdType(type) && definition?.name === "@mediaTypeHint") return;
  state.issue(
    "unsupported-annotation",
    application.node ?? type,
    `Unregistered semantic annotation ${definition ? `${getNamespaceFullName(definition.namespace)}.${definition.name}` : application.decorator.name || "<anonymous>"}`,
    getTypeName(type),
  );
}

/**
 * Encoded-name scope check limited to the JSON name shared by HTTP and IPC
 * @param state - Normalization state receiving the failure
 * @param type - Declaration carrying the application
 * @param application - Registered standard decorator application
 */
function checkEncodedName(
  state: CompileState,
  type: Type,
  application: DecoratorApplication,
): void {
  if (
    application.definition?.name === "@encodedName" &&
    (type.kind !== "ModelProperty" || application.args[0]?.jsValue !== "application/json")
  )
    state.issue(
      "unsupported-encoded-name",
      application.node ?? type,
      "Encoded property names are supported only for application/json shared by HTTP JSON and IPC",
      getTypeName(type),
    );
}
