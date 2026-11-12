import {
  Numeric,
  type ArrayValue,
  type DiagnosticTarget,
  type EnumMember,
  type NumericValue,
  type ObjectValue,
  type Program,
  type ScalarValue,
  type Value,
} from "@typespec/compiler";
import type { Node } from "@typespec/compiler/ast";
import type { Constant, Literal } from "../model/contract-model.js";
import { compareText } from "../model/ordering.js";
import type { IssueSink } from "./issue-sink.js";
import type { ExactNumber } from "./numbers.js";

/** Compiler facilities shared while reading one constant tree */
export interface ConstantSource {
  /** Compiler program retaining exact value provenance */
  readonly program: Program;
  /** Source-addressed failure accumulator */
  readonly issue: IssueSink;
  /** Compiler syntax provenance for numeric tokens */
  readonly exactNumber: ExactNumber;
}

/** Scalar constructors whose single string argument is the exact lexical value */
const lexicalScalars: readonly string[] = [
  "utcDateTime",
  "offsetDateTime",
  "plainDate",
  "plainTime",
  "duration",
];

/**
 * Exact enumeration value from compiler-resolved member source
 * @param member - Resolved member including spread provenance
 * @returns Exact primitive value without binary64 conversion
 */
export function enumLiteral(member: EnumMember): Literal {
  let source = member;
  while (source.sourceMember) source = source.sourceMember;
  const valueNode = source.node?.value;
  if (valueNode && "valueAsString" in valueNode)
    return { kind: "number", text: Numeric(valueNode.valueAsString).toString() };
  if (typeof member.value === "number") return { kind: "number", text: String(member.value) };
  return { kind: "string", value: typeof member.value === "string" ? member.value : member.name };
}

/**
 * Exact compiler constant interpretation without JSON projection
 * @param source - Compiler facilities for exact provenance and failures
 * @param value - Resolved compiler value
 * @param target - Default declaration for diagnostics
 * @param expression - Original compiler expression when lexical spelling is available
 * @returns Compiler-independent constant or an unsupported-value failure
 */
export function readConstant(
  source: ConstantSource,
  value: Value,
  target: DiagnosticTarget,
  expression?: Node,
): Constant | undefined {
  switch (value.valueKind) {
    case "NullValue":
      return { kind: "null" };
    case "StringValue":
      return { kind: "string", value: value.value };
    case "BooleanValue":
      return { kind: "boolean", value: value.value };
    case "NumericValue":
      return readNumber(source, value, target, expression);
    case "EnumValue":
      return enumLiteral(value.value);
    case "ArrayValue":
      return readArray(source, value, target);
    case "ObjectValue":
      return readObject(source, value, target);
    case "ScalarValue":
      return readScalarValue(source, value, target);
    case "Function":
      source.issue(
        "unsupported-default",
        target,
        "Function values cannot be operation input defaults",
      );
      return undefined;
  }
}

/**
 * Exact numeric token recovery for a numeric constant
 * @param source - Compiler facilities for exact provenance
 * @param value - Resolved numeric value
 * @param target - Default declaration for diagnostics
 * @param expression - Original compiler expression when lexical spelling is available
 * @returns Number constant retaining the written spelling
 */
function readNumber(
  source: ConstantSource,
  value: NumericValue,
  target: DiagnosticTarget,
  expression: Node | undefined,
): Constant {
  const exact = source.program.checker.getValueExactType(value);
  return {
    kind: "number",
    text: source.exactNumber(
      expression,
      exact?.kind === "Number" ? exact.valueAsString : value.value.toString(),
      expression ?? target,
    ),
  };
}

/**
 * Array constant with each item read from its own source expression
 * @param source - Compiler facilities for exact provenance and failures
 * @param value - Resolved array value
 * @param target - Default declaration for diagnostics
 * @returns Array constant or undefined when an item is unsupported
 */
function readArray(
  source: ConstantSource,
  value: ArrayValue,
  target: DiagnosticTarget,
): Constant | undefined {
  const items: Constant[] = [];
  for (const [index, item] of value.values.entries()) {
    const constant = readConstant(source, item, target, value.node?.values[index]);
    if (constant === undefined) return undefined;
    items.push(constant);
  }
  return { kind: "array", items };
}

/**
 * Object constant with members in code-unit order
 * @param source - Compiler facilities for exact provenance and failures
 * @param value - Resolved object value
 * @param target - Default declaration for diagnostics
 * @returns Object constant or undefined when a member is unsupported
 */
function readObject(
  source: ConstantSource,
  value: ObjectValue,
  target: DiagnosticTarget,
): Constant | undefined {
  const properties: Record<string, Constant> = Object.create(null) as Record<string, Constant>;
  const members = [...value.properties].sort(([left], [right]) => compareText(left, right));
  for (const [name, property] of members) {
    const constant = readConstant(
      source,
      property.value,
      property.node ?? target,
      property.node?.value,
    );
    if (constant === undefined) return undefined;
    properties[name] = constant;
  }
  return { kind: "object", properties };
}

/**
 * Scalar constructor value limited to the lexical temporal constructors
 * @param source - Compiler facilities for failures
 * @param value - Resolved scalar constructor value
 * @param target - Default declaration for diagnostics
 * @returns String constant holding the lexical argument, or undefined for other constructors
 */
function readScalarValue(
  source: ConstantSource,
  value: ScalarValue,
  target: DiagnosticTarget,
): Constant | undefined {
  let scalar = value.scalar;
  while (scalar.baseScalar) scalar = scalar.baseScalar;
  const argument = value.value.args[0];
  if (
    lexicalScalars.includes(scalar.name) &&
    value.value.name === "fromISO" &&
    value.value.args.length === 1 &&
    argument?.valueKind === "StringValue"
  )
    return { kind: "string", value: argument.value };
  source.issue(
    "unsupported-default",
    target,
    `Scalar constructor ${value.scalar.name}.${value.value.name} has no registered constant interpretation`,
  );
  return undefined;
}
