import type { Constant } from "../../model/contract-model.js";
import { compareText } from "../../model/ordering.js";
import { quote } from "./naming.js";

/** Trusted normalized constant construction through adopted JSON values
 * @param value - Profile-validated exact constant
 * @returns Rust JSON expression without runtime JSON parsing
 */
export function constantValue(value: Constant): string {
  switch (value.kind) {
    case "null":
      return "Value::Null";
    case "boolean":
      return `Value::Bool(${value.value})`;
    case "string":
      return `Value::String(${quote(value.value)}.into())`;
    case "number":
      return `Value::Number(serde_json::Number::from_string_unchecked(${quote(value.text)}.into()))`;
    case "array":
      return `Value::Array(vec![${value.items.map(constantValue).join(",")}])`;
    case "object": {
      const members = Object.entries(value.properties)
        .toSorted(([a], [b]) => compareText(a, b))
        .map(([name, child]) => `(${quote(name)}.into(),${constantValue(child)})`);
      return `Value::Object(serde_json::Map::from_iter([${members.join(",")}]))`;
    }
  }
}
