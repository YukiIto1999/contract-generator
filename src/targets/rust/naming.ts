import type { ContractType, Operation } from "../../model/contract-model.js";
import { directionControls, spellUndocumentable } from "../../model/source-characters.js";

/** Rust keywords and reserved identifiers that cannot spell a generated member */
const reservedWords: Readonly<Record<string, true>> = {
  self: true,
  super: true,
  crate: true,
  type: true,
  match: true,
  ref: true,
  move: true,
  async: true,
  await: true,
  loop: true,
  fn: true,
  pub: true,
  struct: true,
  enum: true,
  use: true,
  mod: true,
  const: true,
  static: true,
  trait: true,
  impl: true,
  where: true,
  in: true,
  as: true,
  dyn: true,
  return: true,
  let: true,
  mut: true,
  default: true,
  box: true,
  try: true,
  gen: true,
  yield: true,
  unsafe: true,
  extern: true,
  break: true,
  continue: true,
  else: true,
  if: true,
  for: true,
  while: true,
  true: true,
  false: true,
};

/** Rust spellings of the JSON escapes that Rust has no escape for */
const jsonOnlyEscapes: Readonly<Record<string, string>> = {
  "\\b": "\\u{8}",
  "\\f": "\\u{c}",
};

/** Every direction control, matched one at a time: JSON leaves them unescaped and rustc refuses them in a literal */
const directionControl = new RegExp(`[${directionControls}]`, "g");

/** Rust literal escaping for an exact UTF-8 value
 * @param value - Unescaped contract spelling
 * @returns Rust string literal
 */
export function quote(value: string): string {
  return JSON.stringify(value)
    .replace(/\\(?:u([0-9a-fA-F]{4})|[\s\S])/g, (escape, unicode: string | undefined) =>
      unicode === undefined ? (jsonOnlyEscapes[escape] ?? escape) : `\\u{${unicode}}`,
    )
    .replace(directionControl, (character) => `\\u{${character.charCodeAt(0).toString(16)}}`);
}

/** Portable Rust field spelling
 * @param value - Canonical declaration spelling
 * @returns Snake case identifier that is never a reserved word
 */
export function snake(value: string): string {
  const name = value
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .toLowerCase();
  return Object.hasOwn(reservedWords, name) ? `${name}_value` : name;
}

/** Stable generated helper suffix of a declaration
 * @param node - Resolved declaration
 * @returns Identifier suffix shared by its codec functions
 */
export function key(node: ContractType): string {
  return snake(node.name);
}

/** Portable operation case stem
 * @param operation - Canonical operation
 * @returns Rust PascalCase stem
 */
export function stem(operation: Operation): string {
  return `${operation.name[0]?.toUpperCase()}${operation.name.slice(1)}`;
}

/** Line ends of documentation text: a bare CR is as much a line end as LF, because rustc rejects it inside a doc comment */
const lineEnd = /\r\n?|\n/;

/** Rustdoc lines of a text
 * @param text - Documentation text
 * @returns One `///` line for every line of the text, with each character that a comment cannot hold safely spelled out
 */
function rustdoc(text: string): string {
  return spellUndocumentable(text)
    .split(lineEnd)
    .map((line) => `/// ${line}`)
    .join("\n");
}

/** Declaration documentation without generated markdown injection
 * @param description - Source contract documentation
 * @param fallback - Purpose when source documentation is absent
 * @returns Rustdoc lines
 */
export function doc(description: string, fallback: string): string {
  return rustdoc(description || fallback);
}

/** Documentation of one parameter as a markdown list item
 * @param name - Parameter spelling
 * @param description - Source contract documentation of the parameter
 * @returns Rustdoc line; the description is joined to one line because an unindented line would only lazily continue the item
 */
export function docItem(name: string, description: string): string {
  return rustdoc(`- ${name}: ${description.split(lineEnd).join(" ")}`);
}
