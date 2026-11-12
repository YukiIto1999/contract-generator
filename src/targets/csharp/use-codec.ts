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
