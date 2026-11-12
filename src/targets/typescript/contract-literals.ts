import type { EnumType, Literal, LiteralType } from "../../model/contract-model.js";
import { declareConstant, type ContractContext } from "./contract-context.js";
import { readerFunction, writerFunction, type Declared, type Parts } from "./contract-shapes.js";
import { camel, quote, type SourcePart } from "./source-text.js";

/**
 * Number literal with an exact canonical JavaScript spelling
 * @param text - Exact literal token
 * @returns Whether a JavaScript number literal denotes exactly the token
 */
export function isNativeNumber(text: string): boolean {
  const parsed = Number(text);
  return String(parsed) === text && (!Number.isInteger(parsed) || Number.isSafeInteger(parsed));
}

/**
 * Public type of a permitted value with exact numeric preservation
 * @param literal - Resolved literal
 * @returns Type expression
 */
export function literalType(literal: Literal): string {
  switch (literal.kind) {
    case "number":
      return isNativeNumber(literal.text)
        ? literal.text
        : `(${quote(literal.text)} & { readonly [representation]: "numberLiteral" })`;
    case "null":
      return "null";
    case "string":
    case "boolean":
      return quote(literal.value);
  }
}

/**
 * Permitted values of a literal or enumeration declaration
 * @param type - Declaration
 * @returns Values in declaration order
 */
function permittedValues(type: LiteralType | EnumType): readonly Literal[] {
  switch (type.kind) {
    case "literal":
      return [type.value];
    case "enum":
      return type.members.map((member) => member.value);
  }
}

/**
 * Acceptance statement of one permitted value
 * @param literal - Permitted value
 * @param name - Public declaration name
 * @param exact - Constant holding the exact value of a numeric literal
 * @returns Statement returning the value when the candidate equals it
 */
function acceptStatement(literal: Literal, name: string, exact: string | undefined): string {
  switch (literal.kind) {
    case "number": {
      const result = isNativeNumber(literal.text) ? literal.text : quote(literal.text);
      const primitive = isNativeNumber(literal.text) ? "number" : "string";
      return `if (numeric !== undefined && compareLosslessNumber(numeric, ${exact}) === 0 && (mode !== "local" || typeof value === "${primitive}")) return ${result} as ${name};`;
    }
    case "null":
      return `if (value === null) return value as ${name};`;
    case "string":
    case "boolean":
      return `if (value === ${quote(literal.value)}) return value as ${name};`;
  }
}

/**
 * Writer statement of a numeric permitted value
 * @param literal - Permitted value
 * @returns Statement producing the exact JSON number, absent for other values
 */
function numericWrite(literal: Literal): string | undefined {
  if (literal.kind !== "number") return undefined;
  const local = isNativeNumber(literal.text) ? literal.text : quote(literal.text);
  return `if (value === ${local}) return new LosslessNumber(${quote(literal.text)});`;
}

/**
 * Literal or enumeration reader and writer
 * @param context - Generation state
 * @param type - Declaration
 * @param declared - Generated names
 * @returns Reader and writer
 */
export function literalParts(
  context: ContractContext,
  type: LiteralType | EnumType,
  declared: Declared,
): Parts {
  const literals = permittedValues(type);
  const numeric = literals.some((literal) => literal.kind === "number");
  const exact = literals.map((literal, index) =>
    literal.kind === "number"
      ? declareConstant(
          context,
          `${camel(type.name)}Value${index + 1}`,
          `Exact permitted numeric value of ${type.name}`,
          `new LosslessNumber(${quote(literal.text)})`,
        )
      : undefined,
  );
  const reader: SourcePart = [
    numeric && "const numeric = literalNumber(value, mode);",
    literals.map((literal, index) => acceptStatement(literal, declared.name, exact[index])),
    'return invalid(state, path, "literal");',
  ];
  const writer: SourcePart = [literals.map(numericWrite), "return value;"];
  return {
    reader: readerFunction(declared.name, declared.reader, numeric ? "moded" : "plain", reader),
    writer: writerFunction(declared.name, declared.writer, "plain", writer),
  };
}
