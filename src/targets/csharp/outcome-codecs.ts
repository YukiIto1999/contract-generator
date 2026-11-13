import type { Operation, Outcome } from "../../model/contract-model.js";
import { decodeOutcome } from "./client-outcome.js";
import { useCheck, type UseCheck } from "./checks.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name, pascal, quote } from "./naming.js";
import { readUse } from "./use-codec.js";

/** Identifier of an operation-scoped declaration
 * @param operation - Operation
 * @param suffix - Declaration role
 * @returns Escaped C# identifier
 */
export function opName(operation: Operation, suffix: string): string {
  return name(pascal(operation.name) + suffix);
}

/** Closed outcome family that holds an outcome
 * @param operation - Operation
 * @param outcome - Outcome
 * @returns Escaped family identifier
 */
export function familyName(operation: Operation, outcome: Outcome): string {
  return opName(operation, outcome.rejection ? "Rejection" : "Success");
}

/** Use-site check shared by every path that completes an outcome payload
 * @param c - Target context
 * @param outcome - Outcome that carries a payload
 * @returns Shared check of the payload position
 */
export function payloadCheck(c: CSharpContext, outcome: Outcome): UseCheck {
  return useCheck(c, `Check${outcome.name}`, outcome.type!, `the ${outcome.name} payload`);
}

/** Payload acceptance of one outcome
 * @param c - Target context
 * @param outcome - Outcome that carries a payload
 * @returns Decoder and validator members
 */
function acceptMembers(c: CSharpContext, outcome: Outcome): string {
  const use = outcome.type!;
  const t = c.use(use);
  const check = payloadCheck(c, outcome);
  const verify = check.call("value", "path", true);
  return lines(
    check.declaration,
    doc(
      "Outcome payload acceptance",
      ["json", "binding"],
      "Accepted payload or positioned violations",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Decode${outcome.name}(string json, string binding = "http") {`,
    `return Wire.Decode<${t}>(json, (element, c, path, binding, encoding) => {`,
    "int beforeRead = c.ViolationCount;",
    `var value = ${readUse(c, use, "element", "path")};`,
    verify && `if (c.ViolationCount == beforeRead) { ${verify} }`,
    "return value;",
    "}, binding);",
    "}",
    doc("Pure outcome payload guard", ["value"], "Accepted payload or positioned violations"),
    `public static Result<Accepted<${t}>, ContractFailure> Validate${outcome.name}(${t} value) { var c = new ReadContext(); ${check.call("value", '""', false)} return c.Finish(value); }`,
  );
}

/** Completion and output of one outcome
 * @param c - Target context
 * @param operation - Operation
 * @param outcome - Outcome that carries a payload
 * @returns Result completion and encoder members
 */
function outputMembers(c: CSharpContext, operation: Operation, outcome: Outcome): string {
  const use = outcome.type!;
  const t = c.use(use);
  const family = familyName(operation, outcome);
  return lines(
    doc(
      "Decoded result completion without public reconstruction",
      ["json", "binding"],
      "Completed outcome or positioned violations",
    ),
    `public static Result<Accepted<${family}>, ContractFailure> Decode${outcome.name}Result(string json, string binding = "http") {`,
    `var decoded = Decode${outcome.name}(json, binding);`,
    `if (decoded.IsFailed(out var failed, out var accepted)) return failed;`,
    `return Result.Succeeded<Accepted<${family}>>(new(${family}.${name(pascal(outcome.name))}.Complete(accepted.Value), accepted.Diagnostics));`,
    "}",
    doc("Outcome payload output guard", ["value", "binding"], "JSON text or positioned violations"),
    `public static Result<string, ContractFailure> Encode${outcome.name}(${t} value, string binding = "http") {`,
    use.nullable && `if (value is null) return Result.Succeeded("null");`,
    `var checkedValue = Validate${outcome.name}(value);`,
    `if (checkedValue.IsFailed(out var failed, out _)) return failed;`,
    `return Result.Succeeded(Wire.Encode<${t}>(value, (writer, value, binding, encoding) => { ${c.codec(use.id)}.Write(writer, ${c.unwrap(use, "value")}, binding, ${c.encoding(use)}); }, binding));`,
    "}",
  );
}

/** Operation-specific IPC envelope boundaries owned by the types assembly
 * @param operation - Operation with IPC bindings
 * @returns Typed envelope decoder and outcome encoder overloads
 */
function ipcMembers(operation: Operation): string {
  if (!operation.ipc) return "";
  return lines(
    doc("Strict IPC response envelope acceptance", ["json"], "Selected typed operation result", {
      throws: [["InvalidOperationException", "An envelope that breaks the operation contract"]],
    }),
    `public static Result<${opName(operation, "Success")}, ${opName(operation, "Failure")}> DecodeIpcEnvelope(string json) {`,
    "try {",
    "using var document = Wire.Parse(json);",
    "var root = document.RootElement;",
    `if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("tag", out var tag) || tag.ValueKind != JsonValueKind.String) throw new InvalidOperationException("Invalid IPC response envelope");`,
    "switch (tag.GetString()) {",
    ...operation.ipc.results.map((mapping) => {
      const outcome = operation.outcomes.find((o) => o.name === mapping.outcome)!;
      return lines(
        `case ${quote(mapping.tag)}: {`,
        outcome.type
          ? `if (!root.TryGetProperty("body", out var body)) throw new InvalidOperationException("Missing IPC payload");`
          : `if (root.TryGetProperty("body", out _)) throw new InvalidOperationException("Void IPC result has a body");`,
        decodeOutcome(operation, outcome, "body.GetRawText()", "ipc", false),
        "}",
      );
    }),
    `default: throw new InvalidOperationException("Unknown IPC result tag");`,
    "}",
    `} catch (JsonException exception) { throw new InvalidOperationException("Invalid IPC response JSON", exception); }`,
    "}",
    ...operation.ipc.results.map((mapping) => {
      const outcome = operation.outcomes.find((o) => o.name === mapping.outcome)!;
      return lines(
        doc(
          "Validated typed IPC response envelope output",
          ["value"],
          "Envelope JSON or positioned violations",
        ),
        `public static Result<string, ContractFailure> EncodeIpcEnvelope(${familyName(operation, outcome)}.${name(pascal(outcome.name))} value) {`,
        outcome.type && `var encoded = Encode${outcome.name}(value.Value, "ipc");`,
        outcome.type && "if (encoded.IsFailed(out var failed, out var body)) return failed;",
        "return Result.Succeeded(Wire.Encode(value, (writer, value, binding, encoding) => {",
        `writer.WriteStartObject(); writer.WriteString("tag", ${quote(mapping.tag)});`,
        outcome.type &&
          'writer.WritePropertyName("body"); writer.WriteRawValue(body, skipInputValidation: true);',
        'writer.WriteEndObject(); }, "ipc"));',
        "}",
      );
    }),
  );
}

/** Binding-aware outcome payload codecs
 * @param c - Target context
 * @param operation - Operation
 * @returns Public payload codecs
 */
export function renderOutcomeCodecs(c: CSharpContext, operation: Operation): string {
  return lines(
    doc(`Binding-specific payload boundaries of the ${operation.name} outcomes`),
    `public static class ${opName(operation, "OutcomeCodecs")} {`,
    ipcMembers(operation),
    ...operation.outcomes
      .filter((outcome) => outcome.type)
      .map((outcome) => lines(acceptMembers(c, outcome), outputMembers(c, operation, outcome))),
    "}",
  );
}
