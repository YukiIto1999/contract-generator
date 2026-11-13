import type { EnumType, Literal, LiteralType } from "../../model/contract-model.js";
import { codecShell } from "./codec-shell.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, quote } from "./naming.js";

/** Membership test of one permitted value
 * @param literal - Permitted value
 * @returns Boolean expression over `value`
 */
function matches(literal: Literal): string {
  switch (literal.kind) {
    case "null":
      return "value is null";
    case "number":
      return `value.IsInitialized && Wire.Compare(value.Text, ${quote(literal.text)}) == 0`;
    case "string":
      return `value == ${quote(literal.value)}`;
    case "boolean":
      return `value == ${literal.value}`;
  }
}

/** Reader statements that bind `value` for the shared primitive kind
 * @param values - Permitted values of one primitive kind
 * @returns Reader statements
 */
function readValue(values: readonly Literal[]): string {
  switch (values[0]!.kind) {
    case "number":
      return lines(
        `if (element.ValueKind != JsonValueKind.Number) { c.Add(path, "literal"); return default; }`,
        "var value = ExactDecimal.Complete(element.GetRawText());",
      );
    case "boolean":
      return lines(
        `if (element.ValueKind is not JsonValueKind.True and not JsonValueKind.False) { c.Add(path, "literal"); return default; }`,
        "var value = element.GetBoolean();",
      );
    case "string":
    case "null": {
      const nullable = values.some((literal) => literal.kind === "null");
      return lines(
        `if (element.ValueKind == JsonValueKind.Null) { ${nullable ? "return default!;" : 'c.Add(path, "null"); return default!;'} }`,
        `if (element.ValueKind != JsonValueKind.String) { c.Add(path, "literal"); return default!; }`,
        "if (!Wire.TryString(element, c, path, out var value)) return default!;",
      );
    }
  }
}

/** Writer statement for the shared primitive kind
 * @param kind - Primitive kind of every permitted value
 * @returns Writer statement over `writer` and `value`
 */
function writeValue(kind: Literal["kind"]): string {
  switch (kind) {
    case "number":
      return "writer.WriteRawValue(value.Text);";
    case "boolean":
      return "writer.WriteBooleanValue(value);";
    case "string":
    case "null":
      return "writer.WriteStringValue(value);";
  }
}

/** Closed set of one primitive kind
 * @param c - Target context
 * @param node - Literal or homogeneous enumeration
 * @returns Codec declaration
 */
export function renderClosed(c: CSharpContext, node: LiteralType | EnumType): string {
  const t = c.type(node.id);
  const values = node.kind === "literal" ? [node.value] : node.members.map((m) => m.value);
  const members = lines(
    doc("Closed literal guard", ["value", "c", "path"]),
    `internal static void Check(${t} value, ReadContext c, Wire.Path path) { if (!(${values.map(matches).join(" || ")})) c.Add(path, "literal"); }`,
    doc(
      "Closed literal JSON acceptance",
      ["element", "c", "path", "binding", "encoding"],
      "Literal candidate that the caller discards when a violation was recorded",
    ),
    `internal static ${t} Read(JsonElement element, ReadContext c, Wire.Path path, string binding, string? encoding) {`,
    readValue(values),
    "Check(value, c, path); return value;",
    "}",
    doc("Literal JSON output", ["writer", "value", "binding", "encoding"]),
    `internal static void Write(Utf8JsonWriter writer, ${t} value, string binding, string? encoding) { ${writeValue(values[0]!.kind)} }`,
  );
  const create = lines(
    doc("Closed literal construction", ["value"], "Literal or positioned violation"),
    `public static Result<Accepted<${t}>, ContractFailure> Create(${t} value) { var c = new ReadContext(); Check(value, c, ""); return c.Finish(value); }`,
  );
  return codecShell(c, node, members, create);
}
