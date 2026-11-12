/** Escapes that denote a character class the translation spells out */
const classEscapes: Readonly<Record<string, string>> = {
  d: "[0-9]",
  D: "[^0-9]",
  w: "[A-Za-z0-9_]",
  W: "[^A-Za-z0-9_]",
  v: "\\x0B",
  f: "\\x0C",
  0: "\\x00",
};

/** Escape letters whose meaning is identical in the Rust expression syntax */
const sharedEscapes: Readonly<Record<string, true>> = { n: true, r: true, t: true, x: true };

/** Translation of one backslash escape
 * @param escape - Character following the backslash
 * @returns Rust expression text, or undefined when the escape has no faithful translation
 */
function translateEscape(escape: string | undefined): string | undefined {
  if (escape === undefined) return undefined;
  const spelled = classEscapes[escape];
  if (spelled !== undefined) return spelled;
  return /[a-zA-Z0-9]/.test(escape) && sharedEscapes[escape] !== true ? undefined : `\\${escape}`;
}

/** Faithful Rust translation of the supported Unicode ECMAScript pattern subset
 * @param pattern - Profile-validated Unicode ECMAScript expression
 * @returns Equivalent Rust expression or unsupported syntax
 */
export function rustPattern(pattern: string): string | undefined {
  if (/\(\?(?!:)|\\[1-9bBpPkKsSu]|(?:\[\]|\[\^\])/.test(pattern)) return undefined;
  let result = "";
  let characterClass = false;
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index] ?? "";
    if (character === "\\") {
      const escaped = translateEscape(pattern[++index]);
      if (escaped === undefined) return undefined;
      result += escaped;
    } else if (characterClass && (character === "[" || character === "&" || character === "~")) {
      result += `\\${character}`;
    } else {
      if (character === "[") characterClass = true;
      if (character === "]") characterClass = false;
      result += character === "." && !characterClass ? "[^\\n\\r\\u{2028}\\u{2029}]" : character;
    }
  }
  return result;
}
