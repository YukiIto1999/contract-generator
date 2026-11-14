import type { TypeUse } from "../../model/contract-model.js";
import { rangeChecks, textChecks } from "./contract-checks.js";
import { readerCall, writerCall } from "./contract-calls.js";
import { referenceType, type ContractContext, type UseEntry } from "./contract-context.js";
import { readerFunction, readerShape, writerShape } from "./contract-shapes.js";
import { quote } from "./source-text.js";

/**
 * Signature of a use-site reader
 * @param context - Generation state
 * @param use - Resolved reference
 * @returns Plain when the referenced reader ignores the candidate origin, otherwise moded
 */
function useShape(context: ContractContext, use: TypeUse): "plain" | "moded" {
  return readerShape(context.byId.get(use.id)!) === "plain" ? "plain" : "moded";
}

/**
 * Use-site reader invocation with exactly the arguments its signature accepts
 * @param context - Generation state
 * @param use - Resolved reference
 * @param name - Use-site reader name
 * @param value - Candidate expression
 * @param path - Location expression
 * @param mode - Candidate origin expression
 * @returns Call expression
 */
export function useCall(
  context: ContractContext,
  use: TypeUse,
  name: string,
  value: string,
  path: string,
  mode = "mode",
): string {
  const call = readerCall(name, useShape(context, use), value, path, undefined, mode);
  return `((yield ${call}) as ${referenceType(context, use)} | undefined)`;
}

/**
 * Whether the writer of a reference depends on the binding
 * @param context - Generation state
 * @param use - Resolved reference
 * @returns Whether the call site must supply the binding
 */
export function useWritesBinding(context: ContractContext, use: TypeUse): boolean {
  return writerShape(context.byId.get(use.id)!, context.bindingTypes) !== "plain";
}

/**
 * Specialized writer invocation for a reference
 * @param context - Generation state
 * @param use - Resolved reference
 * @param value - Value expression
 * @returns Expression honoring explicit nullability and the use-site encoding
 */
export function writeUse(context: ContractContext, use: TypeUse, value: string): string {
  const shape = writerShape(context.byId.get(use.id)!, context.bindingTypes);
  const encoding =
    shape === "encoded" && use.encodings !== undefined
      ? `pickEncoding(binding, ${quote(use.encodings)})`
      : undefined;
  const call = writerCall(context.writers.get(use.id)!, shape, value, encoding);
  return use.nullable ? `(${value} === null ? writeNull() : ${call})` : call;
}

/**
 * Use-site reader declaration
 * @param context - Generation state
 * @param entry - Registered use-site reader
 * @returns Function applying presence, nullability, encoding and use-site restrictions
 */
export function useReaderSource(context: ContractContext, entry: UseEntry): string {
  const { use, name, owner } = entry;
  const node = context.byId.get(use.id)!;
  const shape = readerShape(node);
  const encoding =
    shape === "encoded" && use.encodings !== undefined
      ? `pickEncoding(mode, ${quote(use.encodings)})`
      : undefined;
  const call = readerCall(context.readers.get(use.id)!, shape, "value", "path", encoding);
  const subject = { text: "String(result)", items: "result" };
  const checks = [
    ...textChecks(context, owner, use.constraints, subject),
    ...(node.kind === "scalar" ? rangeChecks(context, owner, use.constraints, subject.text) : []),
  ];
  const body = [
    'if (value === undefined) return invalid(state, path, "undefined");',
    use.nullable
      ? "if (value === null) return null;"
      : 'if (value === null) return invalid(state, path, "null");',
    `const result = (yield ${call}) as ${node.name} | undefined;`,
    "if (result === undefined) return undefined;",
    ...checks,
    "return result;",
  ];
  return readerFunction(
    referenceType(context, use),
    name,
    useShape(context, use),
    body,
    `Use-site ${owner} acceptance with presence, nullability and use-site restrictions`,
  );
}
