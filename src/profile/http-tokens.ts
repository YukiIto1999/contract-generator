import type { ContractType, TypeUse } from "../model/contract-model.js";

/** Valid lowercase HTTP field-name token */
export const headerToken = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

/** Valid media type essence: type and subtype tokens */
const mediaTypeEssence = /^[!#$%&'*+.^_`|~0-9a-z-]+\/[!#$%&'*+.^_`|~0-9a-z-]+$/;

/**
 * Media type essence with normalized case and discarded parameters
 * @param text - Declared HTTP media type
 * @returns Lowercase media type essence for a valid declaration
 */
export function normalizeMediaType(text: string): string | undefined {
  const essence = text.split(";", 1)[0]?.trim().toLowerCase();
  return essence && mediaTypeEssence.test(essence) ? essence : undefined;
}

/**
 * JSON media type test shared by request and result bodies
 * @param mediaType - Normalized media type essence
 * @returns Whether the type is application/json or has a +json suffix
 */
export function isJsonMediaType(mediaType: string): boolean {
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

/**
 * Binary payload identity independent of nominal role
 * @param use - Resolved payload use
 * @param types - Normalized payload graph
 * @returns Byte-sequence scalar semantics
 */
export function isBytes(use: TypeUse, types: ReadonlyMap<string, ContractType>): boolean {
  const type = types.get(use.id);
  return type?.kind === "scalar" && type.scalar === "bytes";
}

/**
 * Whitespace or control character presence
 * @param text - Candidate name
 * @returns Whether any character is at most U+0020 or is U+007F
 */
export function hasWhitespaceOrControl(text: string): boolean {
  return hasCode(text, (code) => code <= 0x20 || code === 0x7f);
}

/**
 * C0 control character presence
 * @param text - Candidate command
 * @returns Whether any character is below U+0020 or is U+007F
 */
export function hasControlCharacter(text: string): boolean {
  return hasCode(text, (code) => code < 0x20 || code === 0x7f);
}

/**
 * Line terminator or NUL presence, which would split a header field
 * @param text - Candidate header value
 * @returns Whether any character is CR, LF or NUL
 */
export function hasLineBreak(text: string): boolean {
  return hasCode(text, (code) => code === 0x0d || code === 0x0a || code === 0);
}

/**
 * Character code predicate over every UTF-16 code unit
 * @param text - Candidate text
 * @param matches - Predicate for a forbidden code unit
 * @returns Whether any code unit satisfies the predicate
 */
function hasCode(text: string, matches: (code: number) => boolean): boolean {
  for (let index = 0; index < text.length; index++)
    if (matches(text.charCodeAt(index))) return true;
  return false;
}
