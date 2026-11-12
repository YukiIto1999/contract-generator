import type { ReaderShape, WriterShape } from "./contract-shapes.js";

/**
 * Reader invocation with exactly the arguments its signature accepts
 * @param name - Reader function name
 * @param shape - Reader signature
 * @param value - Candidate expression
 * @param path - Location expression
 * @param encoding - Use-site encoding override expression, when the reference overrides the encoding
 * @param mode - Candidate origin expression
 * @returns Call expression
 */
export function readerCall(
  name: string,
  shape: ReaderShape,
  value: string,
  path: string,
  encoding?: string,
  mode = "mode",
): string {
  switch (shape) {
    case "plain":
      return `${name}(${value}, ${path}, state)`;
    case "moded":
      return `${name}(${value}, ${path}, state, ${mode})`;
    case "encoded":
      return `${name}(${value}, ${path}, state, ${mode}${encoding === undefined ? "" : `, ${encoding}`})`;
  }
}

/**
 * Writer invocation with exactly the arguments its signature accepts
 * @param name - Writer function name
 * @param shape - Writer signature
 * @param value - Value expression
 * @param encoding - Use-site encoding override expression, when the reference overrides the encoding
 * @returns Call expression
 */
export function writerCall(
  name: string,
  shape: WriterShape,
  value: string,
  encoding?: string,
): string {
  switch (shape) {
    case "plain":
      return `${name}(${value})`;
    case "bound":
      return `${name}(${value}, binding)`;
    case "encoded":
      return `${name}(${value}, binding${encoding === undefined ? "" : `, ${encoding}`})`;
  }
}
