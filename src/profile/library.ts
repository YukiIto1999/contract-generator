import {
  createTypeSpecLibrary,
  paramMessage,
  validateDecoratorUniqueOnNode,
  type DecoratorContext,
  type JSONSchemaType,
  type ModelProperty,
  type Operation,
  type Scalar,
  type Union,
} from "@typespec/compiler";
import { emitterOptionsSchema, type CompilerOptions } from "../emitter-options.js";
import type { Binding, Encoding } from "../model/contract-model.js";
import { encodingMetadata, operationMetadata, stateKeys } from "./metadata.js";

/** Compiler option schema owned by the emitter configuration module */
const optionsSchema: JSONSchemaType<CompilerOptions> = emitterOptionsSchema;

/** TypeSpec diagnostics owned by the public authoring profile */
export const $lib = createTypeSpecLibrary({
  name: "@yukiito1999/contract-generator",
  emitter: { options: optionsSchema },
  diagnostics: {
    "generation-issue": {
      severity: "error",
      messages: { default: paramMessage`${"target"}: ${"subject"}: ${"reason"} [${"rule"}]` },
    },
    "publication-failure": {
      severity: "error",
      messages: { default: paramMessage`${"message"} [${"rule"}]` },
    },
    "publication-cleanup": {
      severity: "warning",
      messages: {
        default: paramMessage`Generated output was published but temporary paths remain: ${"paths"}`,
      },
    },
  },
});

/**
 * Explicit nominal-role declaration
 * @param context - Compiler decorator application
 * @param target - Scalar with a separate public role
 */
function $distinct(context: DecoratorContext, target: Scalar): void {
  validateDecoratorUniqueOnNode(context, target, $distinct);
  context.program.stateSet(stateKeys.distinct).add(target);
}

/**
 * Explicit operation-result union declaration
 * @param context - Compiler decorator application
 * @param target - Named union of operation outcomes
 */
function $outcomes(context: DecoratorContext, target: Union): void {
  validateDecoratorUniqueOnNode(context, target, $outcomes);
  context.program.stateSet(stateKeys.outcomes).add(target);
}

/**
 * Independent scalar spelling-retention declaration
 * @param context - Compiler decorator application
 * @param target - Scalar requiring exact source spelling
 */
function $preserveLexical(context: DecoratorContext, target: Scalar): void {
  validateDecoratorUniqueOnNode(context, target, $preserveLexical);
  context.program.stateSet(stateKeys.preserveLexical).add(target);
}

/**
 * Mandatory binding accumulation without implicit transport defaults
 * @param context - Compiler decorator application
 * @param target - Published operation
 * @param bindings - Required communication interpretations
 */
function $publish(context: DecoratorContext, target: Operation, bindings: Binding[]): void {
  operationMetadata(context.program, target).publications.push({
    value: bindings,
    target: context.decoratorTarget,
  });
}

/**
 * Explicit route declaration retained for whole-operation validation
 * @param context - Compiler decorator application
 * @param target - Operation receiving the route
 * @param method - HTTP method
 * @param path - Absolute route template
 * @param body - Parameter selector or remaining-parameters selector or no-body selector
 */
function $httpBinding(
  context: DecoratorContext,
  target: Operation,
  method: string,
  path: string,
  body?: string,
): void {
  operationMetadata(context.program, target).http.push({
    value: { method, path, ...(body === undefined ? {} : { body }) },
    target: context.decoratorTarget,
  });
}

/**
 * Explicit nonbody request placement
 * @param context - Compiler decorator application
 * @param target - Operation receiving the mapping
 * @param parameter - Canonical parameter name
 * @param location - HTTP request location
 * @param wireName - Parameter name on the wire
 */
function $httpParameter(
  context: DecoratorContext,
  target: Operation,
  parameter: string,
  location: string,
  wireName: string,
): void {
  operationMetadata(context.program, target).parameters.push({
    value: { parameter, location, wireName },
    target: context.decoratorTarget,
  });
}

/**
 * Exact HTTP outcome selector accumulation
 * @param context - Compiler decorator application
 * @param target - Operation receiving the result mapping
 * @param outcome - Canonical result name
 * @param status - Exact response status
 * @param mediaType - Response body media type
 * @param headers - Exact response header selectors
 */
function $httpResult(
  context: DecoratorContext,
  target: Operation,
  outcome: string,
  status: number,
  mediaType?: string,
  headers: Record<string, string> = {},
): void {
  operationMetadata(context.program, target).httpResults.push({
    value: { outcome, status, ...(mediaType === undefined ? {} : { mediaType }), headers },
    target: context.decoratorTarget,
  });
}

/**
 * Host transport command declaration
 * @param context - Compiler decorator application
 * @param target - Operation receiving the command
 * @param command - IPC command identity
 */
function $ipcBinding(context: DecoratorContext, target: Operation, command: string): void {
  operationMetadata(context.program, target).ipc.push({
    value: command,
    target: context.decoratorTarget,
  });
}

/**
 * Exact IPC envelope result declaration
 * @param context - Compiler decorator application
 * @param target - Operation receiving the mapping
 * @param outcome - Canonical result name
 * @param tag - IPC envelope discriminator
 */
function $ipcResult(
  context: DecoratorContext,
  target: Operation,
  outcome: string,
  tag: string,
): void {
  operationMetadata(context.program, target).ipcResults.push({
    value: { outcome, tag },
    target: context.decoratorTarget,
  });
}

/**
 * Independent binding-specific scalar encoding declaration
 * @param context - Compiler decorator application
 * @param target - Scalar or property with a wire override
 * @param binding - Transport owning the override
 * @param encoding - Required wire representation
 */
function $bindingEncoding(
  context: DecoratorContext,
  target: Scalar | ModelProperty,
  binding: Binding,
  encoding: Encoding,
): void {
  encodingMetadata(context.program, target).push({
    value: { binding, encoding },
    target: context.decoratorTarget,
  });
}

/**
 * Provider-only default declaration validated against normalized profile semantics
 * @param context - Compiler decorator application retaining the exact value expression
 * @param target - Optional field receiving a provider acceptance default
 */
function $providerDefault(context: DecoratorContext, target: ModelProperty): void {
  validateDecoratorUniqueOnNode(context, target, $providerDefault);
}

/** Compiler registered implementations for the ContractGenerator namespace */
export const $decorators = {
  ContractGenerator: {
    distinct: $distinct,
    outcomes: $outcomes,
    preserveLexical: $preserveLexical,
    publish: $publish,
    httpBinding: $httpBinding,
    httpParameter: $httpParameter,
    httpResult: $httpResult,
    ipcBinding: $ipcBinding,
    ipcResult: $ipcResult,
    bindingEncoding: $bindingEncoding,
    providerDefault: $providerDefault,
  },
};
