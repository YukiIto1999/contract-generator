import type { UnionType, Variant } from "../../model/contract-model.js";
import { useCheck, type UseCheck } from "./checks.js";
import { codecShell } from "./codec-shell.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name, pascal, quote } from "./naming.js";
import { readUse, writeUse } from "./use-codec.js";

/** One union variant with the use-site check of its payload */
interface VariantPlan {
  /** Resolved variant */
  readonly variant: Variant;
  /** Escaped nested record identifier */
  readonly record: string;
  /** Payload check shared by construction and decoding */
  readonly check: UseCheck;
}

/** Variants with their generated names and payload checks
 * @param c - Target context
 * @param node - Resolved union
 * @returns One plan per variant
 */
function planVariants(c: CSharpContext, node: UnionType): readonly VariantPlan[] {
  return node.variants.map((variant) => ({
    variant,
    record: name(pascal(variant.name)),
    check: useCheck(
      c,
      `Check${pascal(variant.name)}`,
      variant.type,
      `the ${variant.tag} variant payload`,
    ),
  }));
}

/** Nested sealed record of one variant
 * @param c - Target context
 * @param node - Resolved union
 * @param plan - Variant plan
 * @returns Record declaration
 */
function variantDeclaration(c: CSharpContext, node: UnionType, plan: VariantPlan): string {
  const t = c.type(node.id);
  const payload = c.use(plan.variant.type);
  const verify = plan.check.call("value", '""', false);
  return lines(
    doc(`Validated ${plan.variant.tag} variant`),
    `public sealed record ${plan.record} : ${t} {`,
    doc("Immutable variant payload", [], undefined, { value: "Discriminator-consistent payload" }),
    `public ${payload} Value { get; }`,
    doc("Validated variant completion", [["value", "Validated payload"]]),
    `private ${plan.record}(${payload} value) { Value = value; }`,
    doc(
      "Constrained variant construction",
      [["value", "Candidate payload"]],
      "Variant or positioned violations",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Create(${payload} value) { var c = new ReadContext(); ${verify} return c.Finish<${t}>(c.IsValid ? new ${plan.record}(value) : default!); }`,
    doc(
      "Private variant completion shared by construction and decoding",
      [["value", "Validated payload"]],
      "Closed variant",
    ),
    `internal static ${t} Complete(${payload} value) => new ${plan.record}(value);`,
    "}",
  );
}

/** Closed hierarchy declaration
 * @param c - Target context
 * @param node - Resolved union
 * @param plans - Variant plans
 * @returns Declaration source
 */
function declaration(c: CSharpContext, node: UnionType, plans: readonly VariantPlan[]): string {
  return lines(
    doc(node.description || `Closed discriminator union ${node.name}`),
    `[ClosedUnion] public abstract record ${name(node.name)} {`,
    doc("Closed union completion"),
    `private ${name(node.name)}() { }`,
    ...plans.map((plan) => variantDeclaration(c, node, plan)),
    "}",
  );
}

/** Discriminator-selected reader branch
 * @param c - Target context
 * @param node - Resolved union
 * @param plan - Variant plan
 * @returns Switch case source
 */
function readCase(c: CSharpContext, node: UnionType, plan: VariantPlan): string {
  const t = c.type(node.id);
  const verify = plan.check.call("decoded", "path", true);
  return lines(
    `case ${quote(plan.variant.tag)}: {`,
    "int before = c.ViolationCount;",
    `var decoded = ${readUse(c, plan.variant.type, "element", "path")};`,
    verify && `if (c.ViolationCount == before) { ${verify} }`,
    `return ${t}.${plan.record}.Complete(decoded);`,
    "}",
  );
}

/** Union codec with payload checks shared by construction and decoding
 * @param c - Target context
 * @param node - Resolved union
 * @returns Declaration and codec
 */
export function renderUnion(c: CSharpContext, node: UnionType): string {
  const t = c.type(node.id);
  const plans = planVariants(c, node);
  const tagPath = `Wire.At(path, ${quote(node.discriminator)})`;
  const members = lines(
    ...plans.map((plan) => plan.check.declaration),
    doc("Closed variant guard", ["value", "c", "path"]),
    `internal static void Check(${t} value, ReadContext c, string path) { if (value is null) { c.Add(path, "null"); return; } if (${plans.map((p) => `value is not ${t}.${p.record}`).join(" && ")}) c.Add(path, "variant"); }`,
    doc(
      "Discriminator-selected acceptance",
      ["element", "c", "path", "binding", "encoding"],
      "Closed union candidate that the caller discards when a violation was recorded",
    ),
    `internal static ${t} Read(JsonElement element, ReadContext c, string path, string binding, string? encoding) {`,
    `if (element.ValueKind != JsonValueKind.Object) { c.Add(path, element.ValueKind == JsonValueKind.Null ? "null" : "type"); return default!; }`,
    `if (!element.TryGetProperty(${quote(node.discriminator)}, out var tag)) { c.Add(${tagPath}, "required"); return default!; }`,
    `if (tag.ValueKind != JsonValueKind.String) { c.Add(${tagPath}, "variant"); return default!; }`,
    `if (!Wire.TryString(tag, c, ${tagPath}, out var tagText)) return default!;`,
    "switch (tagText) {",
    ...plans.map((plan) => readCase(c, node, plan)),
    `default: c.Add(${tagPath}, "variant"); return default!;`,
    "}",
    "}",
    doc("Closed variant JSON output", ["writer", "value", "binding", "encoding"], undefined, {
      throws: [["InvalidOperationException", "A value outside the closed hierarchy"]],
    }),
    `internal static void Write(Utf8JsonWriter writer, ${t} value, string binding, string? encoding) {`,
    ...plans.map(
      (plan, index) =>
        `if (value is ${t}.${plan.record} variant${index}) { ${writeUse(c, plan.variant.type, `variant${index}.Value`)} return; }`,
    ),
    `throw new InvalidOperationException("Invalid closed union");`,
    "}",
  );
  return lines(declaration(c, node, plans), codecShell(c, node, members, ""));
}
