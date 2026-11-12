/** Unicode bidirectional formatting characters: embeddings, overrides and isolates. They reorder how source text is displayed, and rustc refuses each one in a comment or a literal */
export const directionControls = "\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069";

/** Characters that no comment can hold safely: the direction controls, the C0 controls and the two noncharacters that XML 1.0 forbids, and an unpaired surrogate. Tab, line feed, carriage return, vertical tab and form feed are left to the whitespace handling of each target */
const undocumentable = new RegExp(
  `[${directionControls}\\u0000-\\u0008\\u000E-\\u001F\\uFFFE\\uFFFF]|[\\uD800-\\uDBFF](?![\\uDC00-\\uDFFF])|(?<![\\uD800-\\uDBFF])[\\uDC00-\\uDFFF]`,
  "g",
);

/** Documentation text in which every character that a comment cannot hold safely is spelled out
 * @param text - Source contract documentation
 * @returns Text that reads the same to a person, with each such character written as `\u{XXXX}`
 */
export function spellUndocumentable(text: string): string {
  return text.replace(
    undocumentable,
    (character) => `\\u{${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}}`,
  );
}
