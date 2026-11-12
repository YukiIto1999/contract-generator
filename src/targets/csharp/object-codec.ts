import type { ObjectType } from "../../model/contract-model.js";
import { codecShell } from "./codec-shell.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name, quote } from "./naming.js";
import {
  collectionParameters,
  fieldDocs,
  parameterList,
  positionalDocs,
  type FieldPlan,
} from "./object-plan.js";
import { writeUse, readUse } from "./use-codec.js";

/** Use-site check of one member value held in a possibly optional position
 * @param plan - Field plan
 * @param value - Position expression holding `Presence` for optional fields
 * @param decoded - Whether decoding already validated the member against its own type
 * @returns Statement, or nothing when nothing remains to check
 */
function memberCheck(plan: FieldPlan, value: string, decoded: boolean): string {
  const { field, check } = plan;
  const inner = check.call(field.optional ? `${value}.Value` : value, plan.pointer, decoded);
  return field.optional && inner !== "" ? `if (${value}.IsPresent) { ${inner} }` : inner;
}

/** Construction through positional parameters with every member checked once
 * @param c - Target context
 * @param node - Resolved object
 * @param plans - Field plans
 * @returns Public factory and its shared validation
 */
function createMembers(c: CSharpContext, node: ObjectType, plans: readonly FieldPlan[]): string {
  const t = c.type(node.id);
  const parameters = plans.map((p) => `${c.field(p.field)} f${p.index}`).join(", ");
  const names = plans.map((p) => `f${p.index}`).join(", ");
  return lines(
    doc("Constrained object construction", fieldDocs(node), "Object or positioned violations"),
    `public static Result<Accepted<${t}>, ContractFailure> Create(${parameterList(c, node)}) => CreateCore(${node.fields.map((f) => name(f.name)).join(", ")});`,
    doc(
      "Single immutable graph validation",
      positionalDocs(plans),
      "Immutable object or positioned violations",
    ),
    `private static Result<Accepted<${t}>, ContractFailure> CreateCore(${parameters}) {`,
    "var c = new ReadContext();",
    ...plans.map((plan) => memberCheck(plan, `f${plan.index}`, false)),
    `return c.Finish(c.IsValid ? ${t}.Complete(${names}) : default!);`,
    "}",
  );
}

/** Construction that takes ownership of mutable caller collections
 * @param c - Target context
 * @param node - Resolved object
 * @param plans - Field plans
 * @returns Overload and its single validation, or nothing without collection fields
 */
function ownedMembers(c: CSharpContext, node: ObjectType, plans: readonly FieldPlan[]): string {
  const replace = collectionParameters(c, node);
  if (replace.size === 0) return "";
  const t = c.type(node.id);
  const owns = (plan: FieldPlan): boolean => replace.has(plan.field.name);
  const parameters = plans.map(
    (p) => `${replace.get(p.field.name) ?? c.field(p.field)} f${p.index}`,
  );
  const values = plans.map((p) => (owns(p) ? `owned${p.index}` : `f${p.index}`));
  const body = plans.map((plan) => {
    if (!owns(plan)) return memberCheck(plan, `f${plan.index}`, false);
    const own = `owned${plan.index}`;
    return `if (f${plan.index} is null) c.Add(${plan.pointer}, "null"); else { ${memberCheck(plan, own, false)} }`;
  });
  return lines(
    doc(
      "Owned caller-collection construction",
      fieldDocs(node),
      "Immutable object or positioned violations",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Create(${parameterList(c, node, replace)}) => CreateOwnedCore(${node.fields.map((f) => name(f.name)).join(", ")});`,
    doc(
      "Single validation after mutable storage ownership",
      positionalDocs(plans),
      "Immutable object or positioned violations",
    ),
    `private static Result<Accepted<${t}>, ContractFailure> CreateOwnedCore(${parameters.join(", ")}) {`,
    "var c = new ReadContext();",
    ...plans
      .filter(owns)
      .map(
        (p) =>
          `var owned${p.index} = f${p.index} is null ? default(${c.type(p.field.type.id)}) : f${p.index}.ToImmutableArray();`,
      ),
    ...body,
    `return c.Finish(c.IsValid ? ${t}.Complete(${values.join(", ")}) : default!);`,
    "}",
  );
}

/** Reader branch of one known member
 * @param c - Target context
 * @param plan - Field plan
 * @returns Switch case source
 */
function readCase(c: CSharpContext, plan: FieldPlan): string {
  const { field, index } = plan;
  const pointer = `Wire.At(path, ${quote(field.wireName)})`;
  const present = field.optional ? `Presence<${c.use(field.type)}>.Present(decoded)` : "decoded";
  const verify = plan.check.call("decoded", pointer, true);
  return lines(
    `case ${quote(field.wireName)}: {`,
    `if (seen${index}) c.Add(Wire.At(path, propertyName), "format"); seen${index} = true;`,
    "int before = c.ViolationCount;",
    `var decoded = ${readUse(c, field.type, "property.Value", pointer)};`,
    verify && `if (c.ViolationCount == before) { ${verify} }`,
    `f${index} = ${present}; break;`,
    "}",
  );
}

/** Single-pass object acceptance without public reconstruction
 * @param c - Target context
 * @param node - Resolved object
 * @param plans - Field plans
 * @returns Reader member
 */
function readMember(c: CSharpContext, node: ObjectType, plans: readonly FieldPlan[]): string {
  const t = c.type(node.id);
  return lines(
    doc(
      "Single-pass object acceptance without public reconstruction",
      ["element", "c", "path", "binding", "encoding"],
      "Candidate that the caller discards when a violation was recorded",
    ),
    `internal static ${t} Read(JsonElement element, ReadContext c, string path, string binding, string? encoding) {`,
    `if (element.ValueKind != JsonValueKind.Object) { c.Add(path, element.ValueKind == JsonValueKind.Null ? "null" : "type"); return default!; }`,
    "int beforeObject = c.ViolationCount;",
    ...plans.map((p) => `${c.field(p.field)} f${p.index} = default!; bool seen${p.index} = false;`),
    "foreach (var property in element.EnumerateObject()) {",
    "if (!Wire.TryName(property, c, path, out var propertyName)) continue;",
    "switch (propertyName) {",
    ...plans.map((plan) => readCase(c, plan)),
    "default: c.Unknown(path, propertyName); break;",
    "} }",
    ...plans
      .filter((p) => !p.field.optional)
      .map(
        (p) => `if (!seen${p.index}) c.Add(Wire.At(path, ${quote(p.field.wireName)}), "required");`,
      ),
    `return c.ViolationCount == beforeObject ? ${t}.Complete(${plans.map((p) => `f${p.index}`).join(", ")}) : default!;`,
    "}",
  );
}

/** Member output of one field
 * @param c - Target context
 * @param node - Resolved object
 * @param plan - Field plan
 * @returns Writer statements
 */
function writeCase(c: CSharpContext, node: ObjectType, plan: FieldPlan): string {
  const { field } = plan;
  const v = `value.${c.property(node.id, field.name)}`;
  const write = `writer.WritePropertyName(${quote(field.wireName)}); ${writeUse(c, field.type, field.optional ? `${v}.Value` : v)}`;
  return field.optional ? `if (${v}.IsPresent) { ${write} }` : write;
}

/** Object wire output
 * @param c - Target context
 * @param node - Resolved object
 * @param plans - Field plans
 * @returns Writer member
 */
function writeMember(c: CSharpContext, node: ObjectType, plans: readonly FieldPlan[]): string {
  return lines(
    doc("Immutable object wire output", ["writer", "value", "binding", "encoding"]),
    `internal static void Write(Utf8JsonWriter writer, ${c.type(node.id)} value, string binding, string? encoding) {`,
    "writer.WriteStartObject();",
    ...plans.map((plan) => writeCase(c, node, plan)),
    "writer.WriteEndObject();",
    "}",
  );
}

/** Object codec with validation shared by construction and decoding
 * @param c - Target context
 * @param node - Resolved object
 * @param plans - Field plans
 * @returns Codec declaration
 */
export function objectCodec(
  c: CSharpContext,
  node: ObjectType,
  plans: readonly FieldPlan[],
): string {
  const t = c.type(node.id);
  const members = lines(
    ...plans.map((plan) => plan.check.declaration),
    doc("Immutable object guard", ["value", "c", "path"]),
    `internal static void Check(${t} value, ReadContext c, string path) { if (value is null) c.Add(path, "null"); }`,
    readMember(c, node, plans),
    writeMember(c, node, plans),
  );
  return codecShell(
    c,
    node,
    members,
    lines(createMembers(c, node, plans), ownedMembers(c, node, plans)),
  );
}
