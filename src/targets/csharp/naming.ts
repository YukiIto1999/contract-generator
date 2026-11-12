import { directionControls } from "../../model/source-characters.js";

/** JSON media-type essence classification
 * @param mediaType - Declared media selector
 * @returns Whether the body is a JSON text rather than raw bytes
 */
export function isJsonMediaType(mediaType: string | undefined): boolean {
  const essence = mediaType?.split(";")[0]?.trim().toLowerCase();
  return essence === "application/json" || essence?.endsWith("+json") === true;
}

/** Lowercase media-type essence without parameters
 * @param mediaType - Declared media selector
 * @returns Essence compared case-insensitively on the wire
 */
export function essenceOf(mediaType: string): string {
  return mediaType.split(";")[0]!.trim().toLowerCase();
}

/** Characters that end a line of C# source: CR, LF, NEL, LS and PS (the New_Line_Character set of ECMA-334) */
export const newLineCharacters = "\r\n\u0085\u2028\u2029";

/** Every character that a literal must escape, matched one at a time: the new-line characters that end a line, and the direction controls that reorder how the source is displayed */
const unescaped = new RegExp(`[${newLineCharacters}${directionControls}]`, "gu");

/** Deterministic C# string literal
 * @param value - Literal content
 * @returns Escaped C# literal in which no new-line character ends the line and no direction control reorders the source
 */
export function quote(value: string): string {
  return JSON.stringify(value).replace(
    unescaped,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** Portable declaration identifier
 * @param value - Canonical declaration name
 * @returns Escaped C# identifier
 */
export function name(value: string): string {
  const identifier = value.replace(/[^A-Za-z0-9_]/g, "_") || "_";
  return "@" + (/^[0-9]/.test(identifier) ? "_" + identifier : identifier);
}

/** Portable PascalCase member name
 * @param value - Canonical name
 * @returns PascalCase spelling
 */
export function pascal(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** RFC 6901 pointer literal for a constant wire name
 * @param wireName - Unescaped member name
 * @returns Quoted C# literal of the absolute one-segment pointer
 */
export function pointerLiteral(wireName: string): string {
  return quote("/" + wireName.replaceAll("~", "~0").replaceAll("/", "~1"));
}

/** Source assembly from fragments without blank lines for absent parts
 * @param parts - Source fragments; empty, false and undefined fragments are dropped
 * @returns Newline-joined source
 */
export function lines(...parts: readonly (string | false | undefined)[]): string {
  return parts
    .filter((part): part is string => part !== false && part !== undefined && part !== "")
    .join("\n");
}
