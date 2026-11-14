import type { ScalarType } from "../../model/contract-model.js";
import { codecShell } from "./codec-shell.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, quote } from "./naming.js";
import { scalarCheck } from "./scalar-checks.js";
import { scalarRead } from "./scalar-read.js";
import { roleDeclaration } from "./scalar-role.js";
import { scalarWrite } from "./scalar-write.js";

/** Statement that checks the primitive a scalar wraps
 * @param node - Scalar node
 * @param value - Primitive expression
 * @returns Call of the check that construction and decoding share
 */
function primitiveCheck(node: ScalarType, value: string): string {
  return `${node.role === null ? "Check" : "CheckStorage"}(${value}, c, path);`;
}

/** Check members of a scalar codec
 * @param c - Target context
 * @param node - Scalar node
 * @returns Public-value check, and the primitive check that roles add
 */
function checkMembers(c: CSharpContext, node: ScalarType): string {
  const t = c.type(node.id);
  const storage = c.storage(node);
  if (node.role === null)
    return lines(
      doc("Construction invariant guard", ["value", "c", "path"]),
      `internal static void Check(${t} value, ReadContext c, Wire.Path path) {`,
      scalarCheck(c, node, "value"),
      "}",
    );
  const derived = node.role !== node.id;
  return lines(
    doc("Primitive invariant guard shared by construction and decoding", [
      ["value", "Primitive that the role wraps"],
      "c",
      "path",
    ]),
    `internal static void CheckStorage(${storage} value, ReadContext c, Wire.Path path) {`,
    scalarCheck(c, node, "value"),
    "}",
    doc("Role invariant guard", ["value", "c", "path"]),
    `internal static void Check(${t} value, ReadContext c, Wire.Path path) {`,
    `if (!value.IsInitialized) { c.Add(path, "required"); return; }`,
    derived && "CheckStorage(value.Value, c, path);",
    "}",
  );
}

/** Wire members of a scalar codec
 * @param c - Target context
 * @param node - Scalar node
 * @returns Reader and writer
 */
function wireMembers(c: CSharpContext, node: ScalarType): string {
  const t = c.type(node.id);
  const complete = node.role !== null ? `${t}.Complete(value)` : "value";
  const defaults = `encoding ??= binding == "http" ? ${quote(node.encodings.http)} : ${quote(node.encodings.ipc)};`;
  return lines(
    doc(
      "Binding-specific scalar acceptance",
      ["element", "c", "path", "binding", "encoding"],
      "Candidate that the caller discards when a violation was recorded",
    ),
    `internal static ${t} Read(JsonElement element, ReadContext c, Wire.Path path, string binding, string? encoding) {`,
    defaults,
    scalarRead(c, node),
    primitiveCheck(node, "value"),
    `return ${complete};`,
    "}",
    doc("Binding-specific scalar output", ["writer", "value", "binding", "encoding"]),
    `internal static void Write(Utf8JsonWriter writer, ${t} value, string binding, string? encoding) {`,
    defaults,
    scalarWrite(c, node, node.role !== null ? "value.Value" : "value"),
    "}",
  );
}

/** Native byte completion for bodies that never pass through JSON
 * @param c - Target context
 * @param node - Bytes scalar
 * @returns Reader of raw bytes, or nothing for other meanings
 */
function rawBytesMember(c: CSharpContext, node: ScalarType): string {
  if (node.scalar !== "bytes") return "";
  const t = c.type(node.id);
  return lines(
    doc(
      "Native byte completion without a JSON round trip",
      [["value", "Raw body bytes"], "c", "path"],
      "Completed scalar candidate that the caller discards when a violation was recorded",
    ),
    `internal static ${t} ReadBytes(ImmutableArray<byte> value, ReadContext c, Wire.Path path) {`,
    primitiveCheck(node, "value"),
    `return ${node.role !== null ? `${t}.Complete(value)` : "value"};`,
    "}",
  );
}

/** Construction members of a scalar codec
 * @param c - Target context
 * @param node - Scalar node
 * @returns Public primitive construction
 */
function createMember(c: CSharpContext, node: ScalarType): string {
  const t = c.type(node.id);
  const storage = c.storage(node);
  const value = node.role !== null ? `c.IsValid ? ${t}.Complete(value) : default` : "value";
  return lines(
    doc(
      "Constrained local construction",
      [["value", "Candidate primitive"]],
      "Value or positioned violations",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Create(${storage} value) {`,
    `var c = new ReadContext(); const string path = "";`,
    primitiveCheck(node, "value"),
    `return c.Finish(${value});`,
    "}",
  );
}

/** Scalar declaration and codec
 * @param c - Target context
 * @param node - Scalar meaning
 * @returns Declaration source
 */
export function renderScalar(c: CSharpContext, node: ScalarType): string {
  return lines(
    node.role === node.id && roleDeclaration(c, node),
    codecShell(
      c,
      node,
      lines(checkMembers(c, node), rawBytesMember(c, node), wireMembers(c, node)),
      createMember(c, node),
    ),
  );
}
