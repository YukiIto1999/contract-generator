import type { TypeUse } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";

/** Nullable type-use reader
 * @param c - Target context
 * @param use - Resolved use
 * @param element - JSON element expression
 * @param path - Pointer expression
 * @returns Typed reader expression
 */
export function readUse(c: CSharpContext, use: TypeUse, element: string, path: string): string {
  const read = `${c.codec(use.id)}.Read(${element}, c, ${path}, binding, ${c.encoding(use)})`;
  return use.nullable
    ? `(${element}.ValueKind == JsonValueKind.Null ? (${c.use(use)})null : ${read})`
    : read;
}

/** Nullable type-use writer
 * @param c - Target context
 * @param use - Resolved use
 * @param value - Typed expression
 * @returns Writer statement
 */
export function writeUse(c: CSharpContext, use: TypeUse, value: string): string {
  const write = `${c.codec(use.id)}.Write(writer, ${c.unwrap(use, value)}, binding, ${c.encoding(use)});`;
  return use.nullable ? `if (${value} is null) writer.WriteNullValue(); else ${write}` : write;
}

/** Typed child reader scheduling without recursive traversal
 * @param c - Target context
 * @param use - Resolved use
 * @param element - Stable JSON element expression
 * @param path - Deferred pointer expression
 * @param complete - Typed completion callback expression
 * @returns Child scheduling statement
 */
export function readIntoUse(
  c: CSharpContext,
  use: TypeUse,
  element: string,
  path: string,
  complete: string,
): string {
  const node = c.node(use.id);
  const composite = node.kind === "object" || node.kind === "array" || node.kind === "union";
  const read = composite
    ? `${c.codec(use.id)}.ReadInto(${element}, c, ${path}, binding, ${c.encoding(use)}, pending, decoded => (${complete}).Invoke(decoded));`
    : `pending.Push(() => (${complete}).Invoke(${readUse(c, { ...use, nullable: false }, element, path)}));`;
  return use.nullable
    ? `if (${element}.ValueKind == JsonValueKind.Null) pending.Push(() => (${complete}).Invoke((${c.use(use)})null)); else { ${read} }`
    : read;
}

/** Typed child writer scheduling without recursive traversal
 * @param c - Target context
 * @param use - Resolved use
 * @param value - Stable typed expression
 * @returns Child scheduling statement
 */
export function writeIntoUse(c: CSharpContext, use: TypeUse, value: string): string {
  const node = c.node(use.id);
  const composite = node.kind === "object" || node.kind === "array" || node.kind === "union";
  const write = composite
    ? `${c.codec(use.id)}.WriteInto(writer, ${c.unwrap(use, value)}, binding, ${c.encoding(use)}, pending);`
    : `pending.Push(() => { ${c.codec(use.id)}.Write(writer, ${c.unwrap(use, value)}, binding, ${c.encoding(use)}); });`;
  return use.nullable
    ? `if (${value} is null) pending.Push(writer.WriteNullValue); else { ${write} }`
    : write;
}
