import type {
  ContractType,
  Encoding,
  GenerationIssue,
  Operation,
  Origin,
  ScalarKind,
  TypeUse,
} from "../../model/contract-model.js";
import { CSharpContext } from "./context.js";
import { inputOf } from "./acceptance.js";
import { binaryBody, requestShape } from "./http-request-codec.js";
import { isJsonMediaType, name, pascal } from "./naming.js";
import { reservedNames } from "./reserved-names.js";

/** Reason shared by every unsupported ECMAScript pattern */
const patternReason =
  "ECMAScript regular-expression semantics require an explicit portable-pattern profile before C# emission";

/** Mixed-enumeration case identifiers that nest inside the generated hierarchy */
const mixedCaseNames: readonly string[] = ["Text", "Number", "Flag", "Null"];

/** Source-addressed C# generation failures under construction */
class Collector {
  /** Accumulated failures in discovery order */
  readonly issues: GenerationIssue[] = [];
  /** Subject that owns each generated top-level spelling */
  private readonly declared = new Map<string, string>();

  /** Failure recording
   * @param origin - Original declaration location
   * @param subject - Contract member whose meaning cannot be retained
   * @param reason - Explanation of the missing meaning
   */
  add(origin: Origin, subject: string, reason: string): void {
    this.issues.push({ code: "unsupported-csharp", target: "csharp", origin, subject, reason });
  }

  /** Top-level declaration spelling check
   * @param identifier - Unescaped declaration name
   * @param origin - Original declaration location
   * @param subject - Owner of the spelling
   */
  declare(identifier: string, origin: Origin, subject: string): void {
    const spelling = name(identifier).slice(1);
    if (reservedNames.has(spelling))
      this.add(
        origin,
        subject,
        `Generated C# declaration ${spelling} collides with generated infrastructure or a framework name`,
      );
    const previous = this.declared.get(spelling);
    if (previous !== undefined && previous !== subject)
      this.add(origin, subject, `Generated C# declaration ${spelling} collides with ${previous}`);
    this.declared.set(spelling, subject);
  }

  /** Nested case spelling check
   * @param identifier - Unescaped case name
   * @param enclosing - Unescaped name of the enclosing declaration
   * @param origin - Original declaration location
   * @param subject - Owner of the spelling
   */
  nested(identifier: string, enclosing: string, origin: Origin, subject: string): void {
    const spelling = name(pascal(identifier)).slice(1);
    if (
      reservedNames.has(spelling) ||
      ["Value", "Create", "Complete", name(enclosing).slice(1)].includes(spelling)
    )
      this.add(
        origin,
        subject,
        `Generated C# nested case ${spelling} would shadow a generated member or infrastructure type`,
      );
  }
}

/** Exact binding representation support
 * @param scalar - Resolved scalar meaning
 * @param encoding - Binding-local representation
 * @returns Whether C# can represent the scalar exactly in this encoding
 */
function supportedEncoding(scalar: ScalarKind, encoding: Encoding): boolean {
  switch (encoding) {
    case "json":
    case "string":
      return !["bytes", "offsetDateTime", "utcDateTime"].includes(scalar);
    case "base64":
    case "base64url":
      return scalar === "bytes";
    case "rfc3339":
      return ["offsetDateTime", "utcDateTime", "plainDate", "plainTime"].includes(scalar);
    case "unixTimestamp":
      return false;
  }
}

/** Use-site restrictions and encodings that C# cannot keep
 * @param c - Target context
 * @param collector - Failure collector
 * @param use - Type use
 * @param subject - Contract member that holds the use
 */
function inspectUse(c: CSharpContext, collector: Collector, use: TypeUse, subject: string): void {
  if (use.constraints.pattern !== undefined) collector.add(use.origin, subject, patternReason);
  const node = c.nodes.get(use.id);
  for (const binding of ["http", "ipc"] as const) {
    const encoding = use.encodings?.[binding];
    if (
      encoding !== undefined &&
      (node?.kind !== "scalar" || !supportedEncoding(node.scalar, encoding))
    )
      collector.add(
        use.origin,
        subject,
        `The ${binding} ${encoding} use-site encoding has no exact C# representation`,
      );
  }
}

/** Meanings of one declaration that C# cannot keep
 * @param c - Target context
 * @param collector - Failure collector
 * @param node - Resolved declaration
 */
function inspectNode(c: CSharpContext, collector: Collector, node: ContractType): void {
  switch (node.kind) {
    case "object":
      for (const field of node.fields)
        inspectUse(c, collector, field.type, `${node.id}.${field.name}`);
      break;
    case "array":
      if (node.constraints.pattern !== undefined)
        collector.add(node.origin, node.id, patternReason);
      inspectUse(c, collector, node.element, `${node.id}[]`);
      break;
    case "union":
      for (const variant of node.variants)
        inspectUse(c, collector, variant.type, `${node.id}.${variant.name}`);
      break;
    case "scalar":
      inspectScalar(collector, node);
      break;
    case "enum":
    case "literal":
      break;
  }
}

/** Scalar meanings that C# cannot keep
 * @param collector - Failure collector
 * @param node - Scalar declaration
 */
function inspectScalar(
  collector: Collector,
  node: Extract<ContractType, { kind: "scalar" }>,
): void {
  if (node.constraints.pattern !== undefined) collector.add(node.origin, node.id, patternReason);
  if (node.scalar === "bytes" && node.preserveLexical)
    collector.add(
      node.origin,
      node.id,
      "Byte lexical spelling needs an explicit lexical byte representation distinct from immutable byte content",
    );
  for (const binding of ["http", "ipc"] as const)
    if (!supportedEncoding(node.scalar, node.encodings[binding]))
      collector.add(
        node.origin,
        node.id,
        `The ${binding} ${node.encodings[binding]} encoding has no exact C# representation for ${node.scalar}`,
      );
}

/** Generated spellings that a declaration owns
 * @param collector - Failure collector
 * @param node - Resolved declaration
 */
function declareNode(collector: Collector, node: ContractType): void {
  const owner =
    node.kind === "scalar"
      ? node.role === node.id
      : node.kind !== "array" && node.kind !== "literal";
  const closed =
    node.kind === "enum" && node.members.some((m) => m.value.kind !== node.members[0]?.value.kind);
  if (owner && (node.kind !== "enum" || closed)) collector.declare(node.name, node.origin, node.id);
  collector.declare(node.name + "Codec", node.origin, node.id);
  if (node.kind === "union")
    for (const variant of node.variants)
      collector.nested(variant.name, node.name, variant.origin, `${node.id}.${variant.name}`);
  if (closed)
    for (const entry of mixedCaseNames)
      collector.nested(entry, node.name, node.origin, `${node.id}.${entry}`);
}

/** Generated outcome codec members that would be ambiguous
 * @param collector - Failure collector
 * @param operation - Operation
 */
function inspectCodecMembers(collector: Collector, operation: Operation): void {
  const members = new Set<string>();
  for (const outcome of operation.outcomes.filter((candidate) => candidate.type))
    for (const member of [
      `Decode${outcome.name}`,
      `Decode${outcome.name}Result`,
      `Validate${outcome.name}`,
      `Encode${outcome.name}`,
      `Check${outcome.name}`,
    ]) {
      if (members.has(member))
        collector.add(
          outcome.origin,
          `${operation.id}.${outcome.name}`,
          `Generated outcome codec member ${member} is ambiguous`,
        );
      members.add(member);
    }
}

/** Outcome payloads that cannot keep their HTTP body meaning
 * @param c - Target context
 * @param collector - Failure collector
 * @param operation - Operation
 */
function inspectOutcomes(c: CSharpContext, collector: Collector, operation: Operation): void {
  for (const outcome of operation.outcomes) {
    if (!outcome.type) continue;
    const subject = `${operation.id}.${outcome.name}`;
    inspectUse(c, collector, outcome.type, subject);
    const mapping = operation.http?.results.find((result) => result.outcome === outcome.name);
    const node = c.nodes.get(outcome.type.id);
    if (
      outcome.type.nullable &&
      node?.kind === "scalar" &&
      node.scalar === "bytes" &&
      mapping &&
      !isJsonMediaType(mapping.mediaType)
    )
      collector.add(
        outcome.origin,
        subject,
        "A raw binary HTTP body cannot distinguish null from an empty byte body",
      );
  }
}

/** Generated spellings and unsupported meanings of one operation
 * @param c - Target context
 * @param collector - Failure collector
 * @param operation - Operation
 */
function inspectOperation(c: CSharpContext, collector: Collector, operation: Operation): void {
  const operationName = pascal(operation.name);
  for (const suffix of ["Success", "Rejection", "Failure", "OutcomeCodecs", "Acceptance"])
    collector.declare(operationName + suffix, operation.origin, `${operation.id}.${suffix}`);
  if (inputOf(c, operation).fields.some((field) => field.default !== undefined))
    collector.declare(
      operationName + "AcceptedInput",
      operation.origin,
      `${operation.id}.AcceptedInput`,
    );
  inspectCodecMembers(collector, operation);
  for (const outcome of operation.outcomes)
    collector.nested(
      outcome.name,
      operationName + (outcome.rejection ? "Rejection" : "Success"),
      outcome.origin,
      `${operation.id}.${outcome.name}`,
    );
  inspectOutcomes(c, collector, operation);
  if (requestShape(c, operation) !== "none")
    collector.declare(
      operationName + "HttpRequestCodec",
      operation.origin,
      `${operation.id}.HttpRequestCodec`,
    );
  const raw = binaryBody(c, operation);
  if (raw?.type.nullable)
    collector.add(
      raw.origin,
      `${operation.id}.${raw.name}`,
      "A raw binary HTTP body cannot represent an explicit null separately from missing or empty bytes",
    );
}

/** Every contract meaning that C# cannot keep, addressed at its declaration
 * @param c - Target context
 * @returns Source-addressed failures, empty when the whole contract can be emitted
 */
export function collectIssues(c: CSharpContext): readonly GenerationIssue[] {
  const collector = new Collector();
  for (const node of c.model.types) {
    inspectNode(c, collector, node);
    declareNode(collector, node);
  }
  for (const operation of c.model.operations) inspectOperation(c, collector, operation);
  return collector.issues;
}
