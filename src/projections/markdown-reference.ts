import type {
  ArrayType,
  Constraints,
  ContractModel,
  ContractType,
  EnumType,
  Literal,
  ObjectType,
  Operation,
  Outcome,
  ScalarType,
  TypeUse,
  UnionType,
} from "../model/contract-model.js";
import { constant, requiredNode, serialize, type NodeIndex } from "./reference-document.js";

/** Table-safe reference text
 * @param value - Authored contract text
 * @returns Single Markdown table cell
 */
function cell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("|", "\\|")
    .replaceAll("\r", "")
    .replaceAll("\n", "<br>");
}

/** Markdown table row
 * @param cells - Unescaped cell texts
 * @returns Row with every cell made table-safe
 */
function tableRow(cells: readonly string[]): string {
  return "|" + cells.map(cell).join("|") + "|";
}

/** Human-facing literal notation
 * @param value - Exact canonical literal
 * @returns Literal reference preserving numeric spelling
 */
function literalText(value: Literal): string {
  switch (value.kind) {
    case "number":
      return value.text;
    case "null":
      return "null";
    case "string":
    case "boolean":
      return JSON.stringify(value.value);
  }
}

/** Type use notation without exposing compiler internals
 * @param use - Interpreted type use
 * @param types - Complete interpreted node index
 * @returns Reference type name with explicit null allowance
 */
function typeText(use: TypeUse, types: NodeIndex): string {
  return requiredNode(types, use.id).name + (use.nullable ? " or null" : "");
}

/** Fenced JSON block of restrictions
 * @param constraints - Interpreted restrictions with exact numeric bounds
 * @returns Markdown lines of the block
 */
function constraintBlock(constraints: Constraints): string[] {
  return ["```json", serialize(constraints).trim(), "```"];
}

/** HTTP selector description of an outcome
 * @param operation - Public operation
 * @param outcome - Declared outcome
 * @returns Status, media type and header selectors or an absence mark
 */
function httpSelector(operation: Operation, outcome: Outcome): string {
  const mapping = operation.http?.results.find((candidate) => candidate.outcome === outcome.name);
  if (mapping === undefined) return "—";
  const headers =
    Object.keys(mapping.headers).length === 0 ? "" : " " + JSON.stringify(mapping.headers);
  return String(mapping.status) + " " + (mapping.mediaType ?? "no body") + headers;
}

/** Reference table row of one outcome
 * @param operation - Public operation
 * @param outcome - Declared outcome
 * @param types - Complete interpreted node index
 * @returns Markdown row with channel, payload and both binding selectors
 */
function outcomeRow(operation: Operation, outcome: Outcome, types: NodeIndex): string {
  const ipc = operation.ipc?.results.find((mapping) => mapping.outcome === outcome.name);
  return tableRow([
    outcome.name,
    outcome.rejection ? "rejection" : "success",
    outcome.type === undefined ? "void" : typeText(outcome.type, types),
    httpSelector(operation, outcome),
    ipc?.tag ?? "—",
  ]);
}

/** Reference section of one public operation
 * @param operation - Public operation
 * @param types - Complete interpreted node index
 * @returns Markdown lines of the section
 */
function operationLines(operation: Operation, types: NodeIndex): string[] {
  return [
    "### " + operation.name,
    "",
    operation.description,
    "",
    "|Result|Channel|Payload|HTTP|IPC tag|",
    "|---|---|---|---|---|",
    ...operation.outcomes.map((outcome) => outcomeRow(operation, outcome, types)),
    "",
  ];
}

/** Field table of an object value
 * @param node - Object declaration
 * @param types - Complete interpreted node index
 * @returns Markdown table with provider default column
 */
function objectLines(node: ObjectType, types: NodeIndex): string[] {
  return [
    "|Field|Value|Presence|Provider default|",
    "|---|---|---|---|",
    ...node.fields.map((field) =>
      tableRow([
        field.wireName,
        typeText(field.type, types),
        field.optional ? "optional" : "required",
        field.default === undefined ? "—" : serialize(constant(field.default)).trim(),
      ]),
    ),
  ];
}

/** Meaning, representations and restrictions of a scalar value
 * @param node - Scalar declaration
 * @returns Markdown lines of the description
 */
function scalarLines(node: ScalarType): string[] {
  return [
    "Meaning: `" + node.scalar + "`. Role: " + (node.role ?? "none") + ".",
    "",
    "HTTP encoding: `" + node.encodings.http + "`. IPC encoding: `" + node.encodings.ipc + "`.",
    "",
    ...constraintBlock(node.constraints),
  ];
}

/** Element and cardinality of an array value
 * @param node - Array declaration
 * @param types - Complete interpreted node index
 * @returns Markdown lines of the description
 */
function arrayLines(node: ArrayType, types: NodeIndex): string[] {
  return [
    "Element: " + typeText(node.element, types) + ".",
    "",
    ...constraintBlock(node.constraints),
  ];
}

/** Discriminator and variants of a union value
 * @param node - Union declaration
 * @param types - Complete interpreted node index
 * @returns Markdown lines of the description
 */
function unionLines(node: UnionType, types: NodeIndex): string[] {
  return [
    "Discriminator: `" + node.discriminator + "`.",
    "",
    ...node.variants.map((variant) => "- `" + variant.tag + "`: " + typeText(variant.type, types)),
  ];
}

/** Members of an enumeration value
 * @param node - Enumeration declaration
 * @returns Markdown list of member names and exact values
 */
function enumLines(node: EnumType): string[] {
  return node.members.map((member) => "- " + member.name + ": `" + literalText(member.value) + "`");
}

/** Kind-specific description of one value
 * @param node - Interpreted node
 * @param types - Complete interpreted node index
 * @returns Markdown lines of the description
 */
function kindLines(node: ContractType, types: NodeIndex): string[] {
  switch (node.kind) {
    case "object":
      return objectLines(node, types);
    case "scalar":
      return scalarLines(node);
    case "array":
      return arrayLines(node, types);
    case "union":
      return unionLines(node, types);
    case "enum":
      return enumLines(node);
    case "literal":
      return ["Accepted literal: `" + literalText(node.value) + "`."];
  }
}

/** Generated reader reference for public operations and values
 * @param model - Complete public contract
 * @param types - Complete interpreted node index
 * @returns Markdown reference without unstable source coordinates
 */
export function markdownReference(model: ContractModel, types: NodeIndex): string {
  const lines = [
    "# " + model.namespace,
    "",
    "Reference projection only. The authored contract and profile remain the definitions; this document is not a generation input.",
    "",
    "## Operations",
    "",
    ...model.operations.flatMap((operation) => operationLines(operation, types)),
    "## Values",
    "",
    ...model.types
      .filter((node) => node.exported)
      .flatMap((node) => [
        "### " + node.name,
        "",
        node.description,
        "",
        ...kindLines(node, types),
        "",
      ]),
  ];
  return lines.join("\n");
}
