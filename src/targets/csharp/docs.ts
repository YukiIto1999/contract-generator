import { spellUndocumentable } from "../../model/source-characters.js";
import { name, newLineCharacters } from "./naming.js";

/** Documented parameter: a bare name takes the shared description of that name */
export type DocParam = string | readonly [name: string, description: string];

/** Documentation sections beyond summary, parameters and returns */
export interface DocExtras {
  /** Description of the property value */
  readonly value?: string;
  /** Documented generic parameters */
  readonly typeParams?: readonly DocParam[];
  /** Exception type and the defect that raises it */
  readonly throws?: readonly (readonly [type: string, condition: string])[];
}

/** Descriptions of the parameters that every generated boundary shares */
const shared: Readonly<Record<string, string>> = {
  c: "Violation accumulator of the current boundary",
  path: "RFC 6901 pointer of the value",
  element: "JSON element to read",
  binding: "Binding name, http or ipc",
  encoding: "Use-site encoding override, or null for the binding default",
  writer: "JSON output",
  json: "Complete JSON text",
  value: "Candidate value",
  decoded: "Whether decoding already validated the value against its own type",
  deadline: "Host-owned absolute deadline, forwarded without a timer of its own",
  input: "Operation input",
  request: "Native HTTP request",
  parameters: "JSON object holding the operation parameters",
  command: "Command name",
};

/** Runs of whitespace and of C# new-line characters, which end a documentation comment line even where `\s` omits them */
const whitespaceRun = new RegExp(`[\\s${newLineCharacters}]+`, "gu");

/** XML text escaping with whitespace normalization
 * @param text - Documentation prose
 * @returns Single-line XML text
 */
function xml(text: string): string {
  return spellUndocumentable(text)
    .replace(whitespaceRun, " ")
    .trim()
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** One documented parameter element
 * @param tag - Element name, param or typeparam
 * @param parameter - Parameter name or name with description
 * @returns Documentation line
 * @throws {@link Error} A bare parameter name without a shared description
 */
function parameterLine(tag: "param" | "typeparam", parameter: DocParam): string {
  const [parameterName, description] =
    typeof parameter === "string" ? [parameter, shared[parameter]] : parameter;
  if (description === undefined)
    throw new Error(`Undocumented generated parameter ${parameterName}`);
  return `/// <${tag} name="${name(parameterName).slice(1)}">${xml(description)}</${tag}>`;
}

/** XML documentation contract of one generated declaration
 * @param summary - Purpose of the declaration
 * @param parameters - Documented parameters in declaration order
 * @param returns - Return contract
 * @param extras - Property value, generic parameters and defect exceptions
 * @returns Documentation comment lines without a trailing newline
 */
export function doc(
  summary: string,
  parameters: readonly DocParam[] = [],
  returns?: string,
  extras: DocExtras = {},
): string {
  return [
    `/// <summary>${xml(summary)}</summary>`,
    ...(extras.typeParams ?? []).map((parameter) => parameterLine("typeparam", parameter)),
    ...parameters.map((parameter) => parameterLine("param", parameter)),
    ...(returns === undefined ? [] : [`/// <returns>${xml(returns)}</returns>`]),
    ...(extras.value === undefined ? [] : [`/// <value>${xml(extras.value)}</value>`]),
    ...(extras.throws ?? []).map(
      ([type, condition]) => `/// <exception cref="${type}">${xml(condition)}</exception>`,
    ),
  ].join("\n");
}
