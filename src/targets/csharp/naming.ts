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

/** Deterministic C# string literal
 * @param value - Literal content
 * @returns Escaped C# literal
 */
export function quote(value: string): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
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
