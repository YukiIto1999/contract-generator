import type { ScalarKind, ScalarType } from "../../model/contract-model.js";
import { rangeChecks, textChecks, type NumericLimits } from "./contract-checks.js";
import { declareConstant, preservesUnix, type ContractContext } from "./contract-context.js";
import { readerFunction, writerFunction, type Declared, type Parts } from "./contract-shapes.js";
import { camel, quote, type SourcePart } from "./source-text.js";

/** Primitive that construction accepts for a numeric scalar */
type NumericNative = "text" | "safe" | "bigint" | "float";

/** Intrinsic value ranges of fixed-width integers */
const intrinsicLimits: Readonly<Partial<Record<ScalarKind, readonly [string, string]>>> = {
  int32: ["-2147483648", "2147483647"],
  int64: ["-9223372036854775808", "9223372036854775807"],
  uint64: ["0", "18446744073709551615"],
};

/**
 * Wire encodings of a scalar declaration as a constant
 * @param context - Generation state
 * @param type - Scalar declaration
 * @returns Constant name
 */
function encodingTable(context: ContractContext, type: ScalarType): string {
  return declareConstant(
    context,
    `${camel(type.name)}Encodings`,
    `Wire encodings of ${type.name} by binding`,
    quote(type.encodings),
    "EncodingTable",
  );
}

/**
 * Text-backed scalar reader and writer
 * @param context - Generation state
 * @param type - Scalar declaration
 * @param declared - Generated names
 * @param temporalKind - Calendar rule of a temporal scalar, absent for plain strings
 * @returns Reader and writer
 */
function textParts(
  context: ContractContext,
  type: ScalarType,
  declared: Declared,
  temporalKind?: ScalarKind,
): Parts {
  const reader: SourcePart = [
    'if (typeof value !== "string") return invalid(state, path, "type");',
    'if (!jsonUnicodeScalarString(value)) return invalid(state, path, "format");',
    temporalKind !== undefined &&
      `if (!temporal(value, ${quote(temporalKind)})) return invalid(state, path, "format");`,
    textChecks(context, type.name, type.constraints, { text: "value", items: "value" }),
    `return value as ${declared.name};`,
  ];
  return {
    reader: readerFunction(declared.name, declared.reader, "plain", reader),
    writer: writerFunction(declared.name, declared.writer, "plain", "return value;"),
  };
}

/**
 * UTC instant reader and writer including Unix seconds
 * @param context - Generation state
 * @param type - Scalar declaration
 * @param declared - Generated names
 * @returns Reader and writer
 */
function instantParts(context: ContractContext, type: ScalarType, declared: Declared): Parts {
  const table = encodingTable(context, type);
  const preserved = preservesUnix(context, type);
  const unixSelected = `selectEncoding(mode, encoding, ${table}) === "unixTimestamp"`;
  const reader: SourcePart = [
    `if (${unixSelected}) return readUnixSeconds(value, path, state, ${preserved}) as ${declared.name} | undefined;`,
    preserved &&
      `if (mode === "local" && typeof value === "string" && numberToken.test(value)) return (unixRange(value) ? value : invalid(state, path, "format")) as ${declared.name} | undefined;`,
    'if (typeof value !== "string") return invalid(state, path, "type");',
    'if (!temporal(value, "utcDateTime")) return invalid(state, path, "format");',
    textChecks(context, type.name, type.constraints, { text: "value", items: "value" }),
    `return value as ${declared.name};`,
  ];
  const writer = `return writeInstant(value, selectEncoding(binding, encoding, ${table}), ${preserved});`;
  return {
    reader: readerFunction(declared.name, declared.reader, "encoded", reader),
    writer: writerFunction(declared.name, declared.writer, "encoded", writer),
  };
}

/**
 * Boolean reader and writer
 * @param context - Generation state
 * @param type - Scalar declaration
 * @param declared - Generated names
 * @returns Reader and writer
 */
function booleanParts(context: ContractContext, type: ScalarType, declared: Declared): Parts {
  const table = encodingTable(context, type);
  const read = `return readBoolean(value, path, state, selectEncoding(mode, encoding, ${table})) as ${declared.name} | undefined;`;
  const write = `return selectEncoding(binding, encoding, ${table}) === "string" ? String(value) : value;`;
  return {
    reader: readerFunction(declared.name, declared.reader, "encoded", read),
    writer: writerFunction(declared.name, declared.writer, "encoded", write),
  };
}

/**
 * Bytes reader and writer
 * @param context - Generation state
 * @param type - Scalar declaration
 * @param declared - Generated names
 * @returns Reader and writer
 */
function bytesParts(context: ContractContext, type: ScalarType, declared: Declared): Parts {
  const table = encodingTable(context, type);
  const read = `return readBytes(value, path, state, mode, selectEncoding(mode, encoding, ${table})) as ${declared.name} | undefined;`;
  const write = `return writeBytes(value, selectEncoding(binding, encoding, ${table}));`;
  return {
    reader: readerFunction(declared.name, declared.reader, "encoded", read),
    writer: writerFunction(declared.name, declared.writer, "encoded", write),
  };
}

/**
 * Primitive that construction accepts
 * @param type - Numeric scalar declaration
 * @returns Local acceptance selection
 */
function numericNative(type: ScalarType): NumericNative {
  if (type.scalar === "decimal" || type.scalar === "integer" || type.preserveLexical) return "text";
  switch (type.scalar) {
    case "int64":
    case "uint64":
      return "bigint";
    case "float32":
    case "float64":
      return "float";
    case "int32":
    case "string":
    case "boolean":
    case "bytes":
    case "offsetDateTime":
    case "utcDateTime":
    case "plainDate":
    case "plainTime":
    case "duration":
      return "safe";
  }
}

/**
 * Completed value expression of an accepted numeric token
 * @param native - Accepted primitive
 * @returns Conversion of the validated token
 */
function numericValue(native: NumericNative): string {
  switch (native) {
    case "text":
      return "text";
    case "bigint":
      return "integerValue(text)";
    case "safe":
    case "float":
      return "Number(text)";
  }
}

/**
 * Declared boundaries completed with the intrinsic range of fixed-width integers
 * @param type - Numeric scalar declaration
 * @returns Effective lower and upper boundaries
 */
function effectiveLimits(type: ScalarType): NumericLimits {
  const intrinsic = intrinsicLimits[type.scalar];
  return {
    minimum: type.constraints.minimum ?? (intrinsic && { value: intrinsic[0], exclusive: false }),
    maximum: type.constraints.maximum ?? (intrinsic && { value: intrinsic[1], exclusive: false }),
  };
}

/**
 * Binary floating point width of a scalar
 * @param scalar - Scalar meaning
 * @returns 32 or 64 for floats, otherwise absence
 */
function floatBits(scalar: ScalarKind): 32 | 64 | undefined {
  if (scalar === "float32") return 32;
  return scalar === "float64" ? 64 : undefined;
}

/**
 * Numeric reader and writer
 * @param context - Generation state
 * @param type - Scalar declaration
 * @param declared - Generated names
 * @returns Reader and writer
 */
function numericParts(context: ContractContext, type: ScalarType, declared: Declared): Parts {
  const table = encodingTable(context, type);
  const native = numericNative(type);
  const bits = floatBits(type.scalar);
  const checks = [
    ...textChecks(context, type.name, type.constraints, { text: "text", items: "text" }),
    ...rangeChecks(context, type.name, effectiveLimits(type), "text"),
  ];
  const reader: SourcePart = [
    `const text = numericText(value, mode, selectEncoding(mode, encoding, ${table}), ${quote(native)});`,
    'if (text === undefined) return invalid(state, path, "type");',
    intrinsicLimits[type.scalar] !== undefined || type.scalar === "integer"
      ? 'if (!isIntegral(text)) return invalid(state, path, "type");'
      : false,
    checks.length > 0 && "const before = state.violations.length;",
    checks,
    checks.length > 0 && "if (state.violations.length !== before) return undefined;",
    bits !== undefined &&
      `if (!isFiniteFloat(text, ${bits})) return invalid(state, path, "maximum");`,
    `return ${numericValue(native)} as ${declared.name};`,
  ];
  const write = `return writeNumber(value, selectEncoding(binding, encoding, ${table}));`;
  return {
    reader: readerFunction(declared.name, declared.reader, "encoded", reader),
    writer: writerFunction(declared.name, declared.writer, "encoded", write),
  };
}

/**
 * Scalar reader and writer
 * @param context - Generation state
 * @param type - Scalar declaration
 * @param declared - Generated names
 * @returns Reader and writer specialized for the scalar meaning
 */
export function scalarParts(context: ContractContext, type: ScalarType, declared: Declared): Parts {
  switch (type.scalar) {
    case "string":
      return textParts(context, type, declared);
    case "offsetDateTime":
    case "plainDate":
    case "plainTime":
    case "duration":
      return textParts(context, type, declared, type.scalar);
    case "utcDateTime":
      return instantParts(context, type, declared);
    case "boolean":
      return booleanParts(context, type, declared);
    case "bytes":
      return bytesParts(context, type, declared);
    case "int32":
    case "int64":
    case "uint64":
    case "integer":
    case "decimal":
    case "float32":
    case "float64":
      return numericParts(context, type, declared);
  }
}
