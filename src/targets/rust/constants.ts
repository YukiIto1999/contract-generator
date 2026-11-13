import type { Literal } from "../../model/contract-model.js";
import { quote } from "./naming.js";

/** Trusted primitive literal construction without a public JSON value
 * @param value - Profile-validated exact primitive literal
 * @returns Private primitive node expression without runtime parsing
 */
export function constantValue(value: Literal): string {
  switch (value.kind) {
    case "null":
      return "_JsonNode::Null";
    case "boolean":
      return `_JsonNode::Bool(${value.value})`;
    case "string":
      return `_JsonNode::String(${quote(value.value)}.into())`;
    case "number":
      return `_JsonNode::Number(Number::from_string_unchecked(${quote(value.text)}.into()))`;
  }
}
