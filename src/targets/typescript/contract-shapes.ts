import type { ContractType, ScalarKind } from "../../model/contract-model.js";
import { indent, lines, tsdoc, type DocTags, type SourcePart } from "./source-text.js";

/** Generated names of one declaration */
export interface Declared {
  /** Public declaration name */
  readonly name: string;
  /** Specialized reader function name */
  readonly reader: string;
  /** Specialized writer function name */
  readonly writer: string;
}

/** Specialized reader and writer text of one declaration */
export interface Parts {
  /** Reader function declaration */
  readonly reader: string;
  /** Writer function declaration */
  readonly writer: string;
}

/** Parameters a specialized reader needs beyond the candidate, location and state */
export type ReaderShape = "plain" | "moded" | "encoded";

/** Parameters a specialized writer needs beyond the value */
export type WriterShape = "plain" | "bound" | "encoded";

/** One parameter of a generated function */
interface Parameter {
  /** Parameter identifier */
  readonly name: string;
  /** Declared type */
  readonly type: string;
  /** Contract of the parameter */
  readonly meaning: string;
  /** Whether callers may omit the parameter */
  readonly optional?: true;
}

/**
 * Scalar kinds whose representation depends on the binding encoding
 * @param scalar - Resolved scalar meaning
 * @returns Whether readers and writers receive the selected encoding
 */
export function scalarEncodes(scalar: ScalarKind): boolean {
  switch (scalar) {
    case "boolean":
    case "bytes":
    case "utcDateTime":
    case "int32":
    case "int64":
    case "uint64":
    case "integer":
    case "decimal":
    case "float32":
    case "float64":
      return true;
    case "string":
    case "offsetDateTime":
    case "plainDate":
    case "plainTime":
    case "duration":
      return false;
  }
}

/**
 * Numeric literals among the permitted values of a declaration
 * @param type - Declaration
 * @returns Whether a reader must interpret numeric candidates
 */
function hasNumericLiteral(type: ContractType): boolean {
  switch (type.kind) {
    case "literal":
      return type.value.kind === "number";
    case "enum":
      return type.members.some((member) => member.value.kind === "number");
    case "scalar":
    case "object":
    case "array":
    case "union":
      return false;
  }
}

/**
 * Reader parameters a declaration needs
 * @param type - Declaration
 * @returns Smallest signature that carries everything the specialized reader uses
 */
export function readerShape(type: ContractType): ReaderShape {
  switch (type.kind) {
    case "scalar":
      return scalarEncodes(type.scalar) ? "encoded" : "plain";
    case "literal":
    case "enum":
      return hasNumericLiteral(type) ? "moded" : "plain";
    case "object":
    case "array":
    case "union":
      return "moded";
  }
}

/**
 * Writer parameters a declaration needs
 * @param type - Declaration
 * @param bindingTypes - Identities of declarations whose wire representation depends on the binding
 * @returns Smallest signature that carries everything the specialized writer uses
 */
export function writerShape(type: ContractType, bindingTypes: ReadonlySet<string>): WriterShape {
  switch (type.kind) {
    case "scalar":
      return scalarEncodes(type.scalar) ? "encoded" : "plain";
    case "literal":
    case "enum":
      return "plain";
    case "object":
    case "array":
    case "union":
      return bindingTypes.has(type.id) ? "bound" : "plain";
  }
}

/**
 * Reader parameters of a signature
 * @param shape - Reader signature
 * @returns Parameters in declaration order
 */
function readerParameters(shape: ReaderShape): readonly Parameter[] {
  const common: readonly Parameter[] = [
    { name: "value", type: "unknown", meaning: "Untrusted candidate" },
    { name: "path", type: "string", meaning: "JSON pointer location of the candidate" },
    { name: "state", type: "State", meaning: "Current validation accumulation" },
  ];
  const mode: Parameter = { name: "mode", type: "Mode", meaning: "Candidate origin" };
  const encoding: Parameter = {
    name: "encoding",
    type: "string",
    meaning: "Use-site encoding override",
    optional: true,
  };
  switch (shape) {
    case "plain":
      return common;
    case "moded":
      return [...common, mode];
    case "encoded":
      return [...common, mode, encoding];
  }
}

/**
 * Writer parameters of a signature
 * @param typeName - Public declaration name
 * @param shape - Writer signature
 * @returns Parameters in declaration order
 */
function writerParameters(typeName: string, shape: WriterShape): readonly Parameter[] {
  const value: Parameter = { name: "value", type: typeName, meaning: "Privately completed value" };
  const binding: Parameter = {
    name: "binding",
    type: "WireBinding",
    meaning: "Binding interpretation",
  };
  const encoding: Parameter = {
    name: "encoding",
    type: "string",
    meaning: "Use-site encoding override",
    optional: true,
  };
  switch (shape) {
    case "plain":
      return [value];
    case "bound":
      return [value, binding];
    case "encoded":
      return [value, binding, encoding];
  }
}

/**
 * Documented function declaration of generated support
 * @param summary - Purpose of the function
 * @param name - Function name
 * @param parameters - Parameters in declaration order
 * @param result - Declared return type
 * @param body - Statements of the function
 * @param tags - Return and throw contract
 * @returns Function declaration with its TSDoc
 */
function functionDeclaration(
  summary: string,
  name: string,
  parameters: readonly Parameter[],
  result: string,
  body: SourcePart,
  tags: Pick<DocTags, "returns" | "throws">,
): string {
  const signature = parameters
    .map((parameter) => `${parameter.name}${parameter.optional ? "?" : ""}: ${parameter.type}`)
    .join(", ");
  const doc = tsdoc(summary, {
    params: parameters.map((parameter) => [parameter.name, parameter.meaning]),
    ...tags,
  });
  return lines(doc, `function ${name}(${signature}): ${result} {`, indent(lines(body)), "}");
}

/**
 * Specialized declaration reader
 * @param typeName - Public declaration name
 * @param name - Reader function name
 * @param shape - Reader signature
 * @param body - Statements of the reader
 * @param summary - Purpose of the reader, defaulting to the declaration acceptance
 * @returns Documented function declaration
 */
export function readerFunction(
  typeName: string,
  name: string,
  shape: ReaderShape,
  body: SourcePart,
  summary = `Specialized ${typeName} acceptance`,
): string {
  return functionDeclaration(
    summary,
    name,
    readerParameters(shape),
    `${typeName} | undefined`,
    body,
    { returns: "Entire completed value or the invalid sentinel" },
  );
}

/**
 * Specialized declaration writer
 * @param typeName - Public declaration name
 * @param name - Writer function name
 * @param shape - Writer signature
 * @param body - Statements of the writer
 * @param throws - Whether the writer throws a contract defect for foreign provenance
 * @returns Documented function declaration
 */
export function writerFunction(
  typeName: string,
  name: string,
  shape: WriterShape,
  body: SourcePart,
  throws = false,
): string {
  return functionDeclaration(
    `Specialized ${typeName} wire representation`,
    name,
    writerParameters(typeName, shape),
    "unknown",
    body,
    {
      returns: "Independent wire representation",
      ...(throws
        ? { throws: ["ContractDefect", "Value without declaration provenance"] as const }
        : {}),
    },
  );
}
