import type { ArrayType } from "../../model/contract-model.js";
import { useCheck } from "./checks.js";
import { codecShell } from "./codec-shell.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines } from "./naming.js";
import { readUse, writeUse } from "./use-codec.js";

/** Pointer expression of the element at the loop index */
const elementPath = "Wire.At(path, i.ToString(CultureInfo.InvariantCulture))";

/** Cardinality check shared by construction and decoding
 * @param node - Resolved array
 * @returns Method declaration, or nothing for an unbounded array
 */
function lengthMember(node: ArrayType): string {
  const { minItems, maxItems } = node.constraints;
  if (minItems === undefined && maxItems === undefined) return "";
  return lines(
    doc("Cardinality restrictions shared by construction and decoding", [
      ["count", "Number of elements"],
      "c",
      "path",
    ]),
    "internal static void CheckLength(int count, ReadContext c, string path) {",
    minItems !== undefined && `if (count < ${minItems}) c.Add(path, "minItems");`,
    maxItems !== undefined && `if (count > ${maxItems}) c.Add(path, "maxItems");`,
    "}",
  );
}

/** Whether the array declares a cardinality restriction
 * @param node - Resolved array
 * @returns Restriction presence
 */
function bounded(node: ArrayType): boolean {
  return node.constraints.minItems !== undefined || node.constraints.maxItems !== undefined;
}

/** Array codec with element checks shared by construction and decoding
 * @param c - Target context
 * @param node - Resolved array
 * @returns Codec declaration
 */
export function renderArray(c: CSharpContext, node: ArrayType): string {
  const t = c.type(node.id);
  const element = c.use(node.element);
  const item = useCheck(c, "CheckElement", node.element, "an array element");
  const verify = item.call("decoded", elementPath, true);
  const members = lines(
    item.declaration,
    lengthMember(node),
    doc("Immutable array guard", ["value", "c", "path"]),
    `internal static void Check(${t} value, ReadContext c, string path) {`,
    `if (value.IsDefault) { c.Add(path, "required"); return; }`,
    bounded(node) && "CheckLength(value.Length, c, path);",
    `for (int i = 0; i < value.Length; i++) { ${item.call("value[i]", elementPath, false)} }`,
    "}",
    doc(
      "Immutable array JSON acceptance",
      ["element", "c", "path", "binding", "encoding"],
      "Owned immutable array that the caller discards when a violation was recorded",
    ),
    `internal static ${t} Read(JsonElement element, ReadContext c, string path, string binding, string? encoding) {`,
    `if (element.ValueKind != JsonValueKind.Array) { c.Add(path, element.ValueKind == JsonValueKind.Null ? "null" : "type"); return default; }`,
    `var values = ImmutableArray.CreateBuilder<${element}>(element.GetArrayLength()); int i = 0; int beforeArray = c.ViolationCount;`,
    "foreach (var item in element.EnumerateArray()) {",
    "int beforeItem = c.ViolationCount;",
    `var decoded = ${readUse(c, node.element, "item", elementPath)};`,
    verify && `if (c.ViolationCount == beforeItem) { ${verify} }`,
    "values.Add(decoded); i++;",
    "}",
    bounded(node) && "CheckLength(values.Count, c, path);",
    "return c.ViolationCount == beforeArray ? values.MoveToImmutable() : default;",
    "}",
    doc("Immutable array JSON output", ["writer", "value", "binding", "encoding"]),
    `internal static void Write(Utf8JsonWriter writer, ${t} value, string binding, string? encoding) {`,
    `writer.WriteStartArray(); foreach (var item in value) { ${writeUse(c, node.element, "item")} } writer.WriteEndArray();`,
    "}",
  );
  const create = lines(
    doc(
      "Owned array construction",
      [["items", "Elements to copy"]],
      "Owned immutable array or positioned violations",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Create(IEnumerable<${element}> items) {`,
    `var c = new ReadContext(); if (items is null) { c.Add("", "null"); return c.Finish(default(${t})); }`,
    'var value = items.ToImmutableArray(); Check(value, c, ""); return c.Finish(value);',
    "}",
  );
  return codecShell(c, node, members, create);
}
