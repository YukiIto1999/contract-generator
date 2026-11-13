import type {
  ArrayType,
  Constant,
  Field,
  ObjectType,
  UnionType,
} from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { textChecks } from "./contract-checks.js";
import {
  declareConstant,
  referenceType,
  useReaderName,
  type ContractContext,
} from "./contract-context.js";
import {
  readerFunction,
  writerFunction,
  writerShape,
  type Declared,
  type Parts,
} from "./contract-shapes.js";
import { useCall, writeUse } from "./contract-uses.js";
import { camel, indent, lines, pascal, quote, type SourcePart } from "./source-text.js";

/**
 * Exact profile constant in normalized wire-key representation
 * @param value - Resolved default
 * @returns Constant source expression
 */
function constantSource(value: Constant): string {
  const pending: (Constant | string)[] = [value];
  const chunks: string[] = [];
  while (pending.length > 0) {
    const next = pending.pop()!;
    if (typeof next === "string") {
      chunks.push(next);
      continue;
    }
    switch (next.kind) {
      case "number":
        chunks.push(next.text);
        break;
      case "null":
        chunks.push("null");
        break;
      case "string":
      case "boolean":
        chunks.push(quote(next.value));
        break;
      case "array":
        chunks.push("[");
        pending.push("]");
        for (let index = next.items.length - 1; index >= 0; index--) {
          pending.push(next.items[index]!);
          if (index > 0) pending.push(",");
        }
        break;
      case "object": {
        chunks.push("{");
        pending.push("}");
        const members = Object.entries(next.properties).sort(([left], [right]) =>
          compareText(left, right),
        );
        for (let index = members.length - 1; index >= 0; index--) {
          const [name, child] = members[index]!;
          pending.push(child, ":", quote(name));
          if (index > 0) pending.push(",");
        }
        break;
      }
    }
  }
  return `parseJson(${quote(chunks.join(""))}).unwrap()`;
}

/**
 * Provenance identity of values completed by one reader
 * @param context - Generation state
 * @param id - Declaration identity
 * @returns Expression distinguishing default-completed values when a provider default is reachable
 */
function identityExpression(context: ContractContext, id: string): string {
  return context.defaultTypes.has(id)
    ? `${quote(id)} + (state.defaults ? ":effective" : "")`
    : quote(id);
}

/**
 * Statements reading one object member
 * @param context - Generation state
 * @param type - Containing object declaration
 * @param field - Member declaration
 * @returns Block that reads, defaults or rejects the member
 */
function memberStatements(context: ContractContext, type: ObjectType, field: Field): string {
  const read = useReaderName(context, field.type, `${pascal(type.name)}${pascal(field.name)}`);
  const key =
    field.name === field.wireName
      ? quote(field.name)
      : `mode === "local" ? ${quote(field.name)} : ${quote(field.wireName)}`;
  const target = `output[${quote(field.name)}]`;
  const location = "pointer(path, key)";
  const fallback =
    field.default === undefined
      ? undefined
      : declareConstant(
          context,
          `${camel(type.name)}${pascal(field.name)}Default`,
          `Provider default of ${type.name}.${field.name} in normalized constant form`,
          constantSource(field.default),
        );
  const present = useCall(context, field.type, read, "value[key]", location);
  const absent: SourcePart = [
    fallback !== undefined &&
      `else if (state.defaults) ${target} = ${useCall(context, field.type, read, fallback, location, '"constant"')};`,
    !field.optional && `else invalid(state, ${location}, "required");`,
  ];
  return lines(
    "{",
    indent(
      lines(
        `const key = ${key};`,
        `if (Object.hasOwn(value, key)) ${target} = ${present};`,
        absent,
      ),
    ),
    "}",
  );
}

/**
 * Object reader and writer
 * @param context - Generation state
 * @param type - Object declaration
 * @param declared - Generated names
 * @returns Reader and writer
 */
export function objectParts(context: ContractContext, type: ObjectType, declared: Declared): Parts {
  const names = type.fields.map((field) => field.name);
  const wireNames = type.fields.map((field) => field.wireName);
  const allowed = type.fields.every((field) => field.name === field.wireName)
    ? quote(names)
    : `mode === "local" ? ${quote(names)} : ${quote(wireNames)}`;
  const reader: SourcePart = [
    `const identity = ${identityExpression(context, type.id)};`,
    `if (mode === "local" && known(value, identity)) return value as ${declared.name};`,
    "if (!enterObject(value, path, state)) return undefined;",
    "const before = state.violations.length;",
    "const output: Record<string, unknown> = Object.create(null);",
    type.fields.map((field) => memberStatements(context, type, field)),
    `reportUnknown(value, path, state, ${allowed});`,
    `return leave(value, state, before) ? (complete(output, identity) as unknown as ${declared.name}) : undefined;`,
  ];
  const writer: SourcePart = [
    'yield { kind: "object" };',
    type.fields.map((field) => {
      const member = `value[${quote(field.name)}]`;
      const emit = `yield { kind: "key", key: ${quote(field.wireName)} }; yield ${writeUse(context, field.type, member)};`;
      return field.optional ? `if (${member} !== undefined) { ${emit} }` : emit;
    }),
    'yield { kind: "end" };',
  ];
  return {
    reader: readerFunction(declared.name, declared.reader, "moded", reader),
    writer: writerFunction(
      declared.name,
      declared.writer,
      writerShape(type, context.bindingTypes),
      writer,
      false,
      true,
    ),
  };
}

/**
 * Array reader and writer
 * @param context - Generation state
 * @param type - Array declaration
 * @param declared - Generated names
 * @returns Reader and writer
 */
export function arrayParts(context: ContractContext, type: ArrayType, declared: Declared): Parts {
  const element = useReaderName(context, type.element, `${pascal(type.name)}Element`);
  const read = useCall(
    context,
    type.element,
    element,
    "value[position]",
    "pointer(path, position)",
  );
  const reader: SourcePart = [
    `const identity = ${identityExpression(context, type.id)};`,
    `if (mode === "local" && known(value, identity)) return value as ${declared.name};`,
    "if (!enterArray(value, path, state)) return undefined;",
    "const before = state.violations.length;",
    textChecks(context, type.name, type.constraints, { text: "value", items: "value" }),
    "const output: unknown[] = [];",
    "for (let position = 0; position < value.length; position++) {",
    `  output.push(${read});`,
    "}",
    `return leave(value, state, before) ? (complete(output, identity) as unknown as ${declared.name}) : undefined;`,
  ];
  const writer = [
    'yield { kind: "array" };',
    `for (const element of value) yield ${writeUse(context, type.element, "element")};`,
    'yield { kind: "end" };',
  ];
  return {
    reader: readerFunction(declared.name, declared.reader, "moded", reader),
    writer: writerFunction(
      declared.name,
      declared.writer,
      writerShape(type, context.bindingTypes),
      writer,
      false,
      true,
    ),
  };
}

/**
 * Local discriminator member name of a union
 * @param context - Generation state
 * @param type - Union declaration
 * @returns Canonical member name of the first variant's discriminator, or the wire name
 */
function localDiscriminator(context: ContractContext, type: UnionType): string {
  const first = type.variants[0];
  const node = first === undefined ? undefined : context.byId.get(first.type.id);
  const member =
    node?.kind === "object"
      ? node.fields.find((field) => field.wireName === type.discriminator)
      : undefined;
  return member?.name ?? type.discriminator;
}

/**
 * Union reader and writer
 * @param context - Generation state
 * @param type - Union declaration
 * @param declared - Generated names
 * @returns Reader and writer dispatching on the discriminator
 */
export function unionParts(context: ContractContext, type: UnionType, declared: Declared): Parts {
  const local = localDiscriminator(context, type);
  const tagKey =
    local === type.discriminator
      ? quote(local)
      : `mode === "local" ? ${quote(local)} : ${quote(type.discriminator)}`;
  const cases = type.variants.map((variant) => {
    const name = useReaderName(
      context,
      variant.type,
      `${pascal(type.name)}${pascal(variant.name)}`,
    );
    return `case ${quote(variant.tag)}: output = ${useCall(context, variant.type, name, "value", "path")}; break;`;
  });
  const reader: SourcePart = [
    `const identity = ${identityExpression(context, type.id)};`,
    `if (mode === "local" && known(value, identity)) return value as ${declared.name};`,
    'if (!objectValue(value)) return invalid(state, path, "type");',
    "const before = state.violations.length;",
    `let output: ${declared.name} | undefined;`,
    `switch (value[${tagKey}]) {`,
    indent(lines(cases)),
    `  default: return invalid(state, pointer(path, ${quote(type.discriminator)}), "variant");`,
    "}",
    "return state.violations.length === before && output !== undefined ? complete(output, identity) : undefined;",
  ];
  const writer: SourcePart = [
    `switch ((value as unknown as Record<string, unknown>)[${quote(local)}]) {`,
    type.variants.map(
      (variant) =>
        `  case ${quote(variant.tag)}: yield ${writeUse(context, variant.type, `value as ${referenceType(context, variant.type)}`)}; return;`,
    ),
    '  default: throw new ContractDefect("Invalid union provenance");',
    "}",
  ];
  return {
    reader: readerFunction(declared.name, declared.reader, "moded", reader),
    writer: writerFunction(
      declared.name,
      declared.writer,
      writerShape(type, context.bindingTypes),
      writer,
      true,
      true,
    ),
  };
}
