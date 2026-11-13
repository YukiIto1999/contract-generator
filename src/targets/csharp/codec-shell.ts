import type { ContractType } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name } from "./naming.js";

/** Public codec class around the members that one node kind implements
 * @param c - Target context
 * @param node - Resolved node
 * @param members - Generated construction helpers and wire members
 * @param create - Public construction members
 * @returns Codec declaration
 */
export function codecShell(
  c: CSharpContext,
  node: ContractType,
  members: string,
  create: string,
): string {
  const t = c.type(node.id);
  const composite = node.kind === "object" || node.kind === "array" || node.kind === "union";
  return lines(
    doc(`Validated construction and wire boundary of ${node.name}`),
    `public static class ${name(node.name + "Codec")} {`,
    create,
    doc(
      "Complete JSON input acceptance",
      ["json", "binding"],
      "Accepted value or positioned violations",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Decode(string json, string binding = "http") => Wire.Decode(json, Read, binding);`,
    doc(
      "Immutable graph acceptance without reconstruction",
      ["value"],
      "Accepted graph or positioned violations",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Validate(${t} value) { var c = new ReadContext(); Check(value, c, ""); return c.Finish(value); }`,
    doc("Validated JSON output", ["value", "binding"], "JSON text or positioned violations"),
    `public static Result<string, ContractFailure> Encode(${t} value, string binding = "http") {`,
    `var c = new ReadContext(); Check(value, c, "");`,
    `if (!c.IsValid) return Result.Failed(c.Failure);`,
    `return Result.Succeeded(Wire.Encode(value, Write, binding));`,
    "}",
    composite &&
      lines(
        doc(
          "Stack-safe typed JSON acceptance",
          ["element", "c", "path", "binding", "encoding"],
          "Completed candidate",
        ),
        `internal static ${t} Read(JsonElement element, ReadContext c, Wire.Path path, string binding, string? encoding) => Wire.ReadFrames<${t}>((pending, complete) => ReadInto(element, c, path, binding, encoding, pending, complete));`,
        doc("Stack-safe typed JSON output", ["writer", "value", "binding", "encoding"]),
        `internal static void Write(Utf8JsonWriter writer, ${t} value, string binding, string? encoding) => Wire.WriteFrames(pending => WriteInto(writer, value, binding, encoding, pending));`,
      ),
    members,
    "}",
  );
}
