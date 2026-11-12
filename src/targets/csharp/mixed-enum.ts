import type { EnumType, Literal } from "../../model/contract-model.js";
import { codecShell } from "./codec-shell.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name, quote } from "./naming.js";

/** One generated case of a mixed enumeration */
interface Case {
  /** JSON value kind that the case represents */
  readonly kind: Literal["kind"];
  /** Nested record identifier */
  readonly record: string;
  /** Payload storage, absent for the null case */
  readonly storage: string | undefined;
  /** Permitted members of this kind */
  readonly members: readonly Literal[];
}

/** Cases in a fixed order for the kinds that the members span
 * @param node - Mixed enumeration
 * @returns One case per member kind
 */
function casesOf(node: EnumType): readonly Case[] {
  const shapes: readonly (readonly [Literal["kind"], string, string | undefined])[] = [
    ["string", "Text", "string"],
    ["number", "Number", "ExactDecimal"],
    ["boolean", "Flag", "bool"],
    ["null", "Null", undefined],
  ];
  return shapes
    .map(([kind, record, storage]) => ({
      kind,
      record,
      storage,
      members: node.members.map((member) => member.value).filter((value) => value.kind === kind),
    }))
    .filter((entry) => entry.members.length > 0);
}

/** Membership test of the payload of one case
 * @param entry - Case
 * @param payload - Payload expression
 * @returns Boolean expression
 */
function membership(entry: Case, payload: string): string {
  return entry.members
    .map((literal) => {
      switch (literal.kind) {
        case "string":
          return `${payload} == ${quote(literal.value)}`;
        case "number":
          return `${payload}.IsInitialized && Wire.Compare(${payload}.Text, ${quote(literal.text)}) == 0`;
        case "boolean":
          return `${payload} == ${literal.value}`;
        case "null":
          return "true";
      }
    })
    .join(" || ");
}

/** Nested record of one case
 * @param c - Target context
 * @param node - Mixed enumeration
 * @param entry - Case
 * @returns Record declaration
 */
function caseDeclaration(c: CSharpContext, node: EnumType, entry: Case): string {
  const root = c.qualified(node.name);
  const codec = c.codec(node.id);
  const payload = entry.storage;
  const argument = payload === undefined ? "" : `${payload} value`;
  const supplied = payload === undefined ? "" : "value";
  return lines(
    doc(`Case that holds a ${entry.kind} member of ${node.name}`),
    `public sealed record ${entry.record} : ${root} {`,
    payload !== undefined &&
      doc("Held member value", [], undefined, { value: `Permitted ${entry.kind} member` }),
    payload !== undefined && `public ${payload} Value { get; }`,
    doc("Case completion", payload === undefined ? [] : [["value", "Permitted member"]]),
    `private ${entry.record}(${argument}) { ${payload === undefined ? "" : "Value = value;"} }`,
    doc(
      "Validated case construction",
      payload === undefined ? [] : [["value", "Candidate member"]],
      "Case or positioned violation",
    ),
    `public static Result<Accepted<${root}>, ContractFailure> Create(${argument}) => ${codec}.Validate(new ${entry.record}(${supplied}));`,
    doc(
      "Case completion shared by construction and decoding",
      payload === undefined ? [] : [["value", "Candidate member"]],
      "Completed case",
    ),
    `internal static ${root} Complete(${argument}) => new ${entry.record}(${supplied});`,
    "}",
  );
}

/** Closed case hierarchy declaration
 * @param c - Target context
 * @param node - Mixed enumeration
 * @param cases - Cases
 * @returns Declaration source
 */
function declaration(c: CSharpContext, node: EnumType, cases: readonly Case[]): string {
  const self = name(node.name);
  return lines(
    doc(node.description || `Closed set of exact values of several JSON kinds for ${node.name}`),
    `[ClosedUnion] public abstract record ${self} {`,
    doc("Closed hierarchy completion"),
    `private ${self}() { }`,
    ...cases.map((entry) => caseDeclaration(c, node, entry)),
    "}",
  );
}

/** Check and reader members
 * @param cases - Cases
 * @param t - Public representation
 * @returns Codec members
 */
function readMembers(cases: readonly Case[], t: string): string {
  const has = (kind: Literal["kind"]): Case | undefined =>
    cases.find((entry) => entry.kind === kind);
  const complete = (entry: Case | undefined, payload: string): string =>
    entry === undefined ? "" : `${t}.${entry.record}.Complete(${payload})`;
  return lines(
    doc("Closed member guard", ["value", "c", "path"]),
    `internal static void Check(${t} value, ReadContext c, string path) {`,
    `if (value is null) { c.Add(path, "null"); return; }`,
    ...cases.map((entry) =>
      entry.storage === undefined
        ? `if (value is ${t}.${entry.record}) return;`
        : `if (value is ${t}.${entry.record} ${entry.record.toLowerCase()}) { if (!(${membership(entry, `${entry.record.toLowerCase()}.Value`)})) c.Add(path, "literal"); return; }`,
    ),
    `c.Add(path, "variant");`,
    "}",
    doc(
      "Closed member JSON acceptance",
      ["element", "c", "path", "binding", "encoding"],
      "Candidate that the caller discards when a violation was recorded",
    ),
    `internal static ${t} Read(JsonElement element, ReadContext c, string path, string binding, string? encoding) {`,
    `${t} candidate;`,
    "switch (element.ValueKind) {",
    has("string") &&
      `case JsonValueKind.String: { if (!Wire.TryString(element, c, path, out var text)) return default!; candidate = ${complete(has("string"), "text")}; break; }`,
    has("number") &&
      `case JsonValueKind.Number: candidate = ${complete(has("number"), "ExactDecimal.Complete(element.GetRawText())")}; break;`,
    has("boolean") &&
      `case JsonValueKind.True: case JsonValueKind.False: candidate = ${complete(has("boolean"), "element.GetBoolean()")}; break;`,
    has("null")
      ? `case JsonValueKind.Null: candidate = ${complete(has("null"), "")}; break;`
      : `case JsonValueKind.Null: c.Add(path, "null"); return default!;`,
    `default: c.Add(path, "literal"); return default!;`,
    "}",
    "Check(candidate, c, path); return candidate;",
    "}",
  );
}

/** Output of one validated mixed-enumeration member
 * @param entry - Case
 * @param t - Public representation
 * @returns Unit-valued writer declaration
 */
function writeCase(entry: Case, t: string): string {
  let statement: string;
  switch (entry.kind) {
    case "string":
      statement = "writer.WriteStringValue(value.Value);";
      break;
    case "number":
      statement = "writer.WriteRawValue(value.Value.Text);";
      break;
    case "boolean":
      statement = "writer.WriteBooleanValue(value.Value);";
      break;
    case "null":
      statement = "writer.WriteNullValue();";
      break;
  }
  return lines(
    doc("Validated mixed member output", ["writer", "value"], "Completed output"),
    `private static global::TypeModeling.Domain.Unit Write${entry.record}(Utf8JsonWriter writer, ${t}.${entry.record} value) {`,
    statement,
    "return global::TypeModeling.Domain.Unit.Value;",
    "}",
  );
}

/** Exhaustive writer of the closed mixed-enumeration family
 * @param cases - Cases
 * @param t - Public representation
 * @returns Writer with unit-valued case completions
 */
function writeMember(cases: readonly Case[], t: string): string {
  return lines(
    doc("Closed member JSON output", ["writer", "value", "binding", "encoding"], undefined, {
      throws: [
        [
          "System.Runtime.CompilerServices.SwitchExpressionException",
          "A value outside the closed hierarchy",
        ],
      ],
    }),
    `internal static void Write(Utf8JsonWriter writer, ${t} value, string binding, string? encoding) {`,
    "_ = value switch {",
    ...cases.map((entry) => `${t}.${entry.record} member => Write${entry.record}(writer, member),`),
    "};",
    "}",
    ...cases.map((entry) => writeCase(entry, t)),
  );
}

/** Enumeration whose members span several JSON value kinds as a closed case hierarchy
 * @param c - Target context
 * @param node - Mixed enumeration
 * @returns Declaration and codec
 */
export function renderMixedEnum(c: CSharpContext, node: EnumType): string {
  const cases = casesOf(node);
  const t = c.type(node.id);
  return lines(
    declaration(c, node, cases),
    codecShell(c, node, lines(readMembers(cases, t), writeMember(cases, t)), ""),
  );
}
