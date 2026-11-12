/** Code-unit ordering independent of locale for deterministic output
 * @param left - First text
 * @param right - Second text
 * @returns Negative, zero, or positive in lexical order
 */
export function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
