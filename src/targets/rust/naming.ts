import type { ContractType, Operation } from "../../model/contract-model.js";

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

/** Rust literal escaping for an exact UTF-8 value
 * @param value - Unescaped contract spelling
 * @returns Rust string literal
 */
export function quote(value: string): string {
  return JSON.stringify(value).replace(/\\u([0-9a-fA-F]{4})/g, "\\u{$1}");
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

/** Declaration documentation without generated markdown injection
 * @param description - Source contract documentation
 * @param fallback - Purpose when source documentation is absent
 * @returns Rustdoc lines
 */
export function doc(description: string, fallback: string): string {
  return (description || fallback)
    .split(/\r?\n/)
    .map((line) => `/// ${line}`)
    .join("\n");
}
