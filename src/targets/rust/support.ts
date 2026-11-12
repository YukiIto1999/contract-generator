/** Support declaration emitted only while generated code can reach it */
export interface Support {
  /** Reference form of the declaration within generated Rust code */
  readonly reaches: RegExp;
  /** Complete Rust declaration including its documentation */
  readonly source: string;
}

/** Syntax that references a support declaration */
export type SupportKind = "function" | "macro" | "type";

/** Support declaration identified by the Rust syntax that references it
 * @param name - Declared Rust identifier
 * @param source - Complete Rust declaration
 * @param kind - Call syntax, macro invocation or type naming that reaches the declaration
 * @returns Declaration with its own reachability test
 */
export function support(name: string, source: string, kind: SupportKind = "function"): Support {
  const reaches =
    kind === "function"
      ? `(?<![\\w.])(?<!fn )${name}\\(`
      : kind === "macro"
        ? `(?<!\\w)${name}!`
        : `\\b${name}\\b`;
  return { reaches: new RegExp(reaches), source };
}

/** Declarations reachable from generated code, in declaration order
 * @param body - Generated Rust that may reference support declarations
 * @param declarations - Candidate declarations in emission order
 * @returns Concatenated declarations whose absence would break compilation, so no dead helper survives
 */
export function reachable(body: string, declarations: readonly Support[]): string {
  const kept = new Set<Support>();
  for (let grew = true; grew;) {
    grew = false;
    const scope = `${body}\n${[...kept].map((declaration) => declaration.source).join("\n")}`
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");
    for (const declaration of declarations) {
      if (kept.has(declaration) || !declaration.reaches.test(scope)) continue;
      kept.add(declaration);
      grew = true;
    }
  }
  return declarations
    .filter((declaration) => kept.has(declaration))
    .map((declaration) => declaration.source)
    .join("");
}
