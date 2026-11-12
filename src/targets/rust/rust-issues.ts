import type {
  ContractModel,
  ContractType,
  GenerationIssue,
  ScalarType,
  TypeUse,
} from "../../model/contract-model.js";
import type { Report } from "./issue-report.js";
import { checkDefaults, checkHttp, checkOperationNames } from "./operation-issues.js";
import { snake } from "./naming.js";
import { rustPattern } from "./patterns.js";

/** Generated names that a contract declaration must not reuse */
const reservedNames = new Set([
  "Self",
  "Accepted",
  "Binding",
  "Diagnostic",
  "Violation",
  "ValidationFailure",
  "ExactNumber",
  "State",
  "String",
  "Vec",
  "Option",
  "Result",
  "Value",
  "Map",
  "Number",
  "BigInt",
  "Ordering",
  "Box",
  "CommunicationFailure",
  "OperationFailure",
  "HandlerFailure",
  "ProviderFailure",
  "IpcTransport",
  "CancellationToken",
  "Instant",
  "HttpTransport",
  "HttpResponse",
  "ReqwestTransport",
  "Handler",
  "Future",
]);

/** Scalar meanings that have no source spelling beyond their value */
const spellingless = new Set(["boolean", "bytes"]);

/** Contract names and snake-case codec names that collide in the generated crates
 * @param model - Complete normalized contract
 * @param prefix - Requested Cargo package prefix
 * @param report - Issue sink
 */
function checkNames(model: ContractModel, prefix: string, report: Report): void {
  const first = model.types[0]?.origin ?? model.operations[0]?.origin;
  if (!/^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/.test(prefix) && first)
    report(first, model.namespace, "rustCratePrefix must be a lowercase Cargo package prefix");
  const names = new Set<string>();
  const helpers = new Set<string>();
  for (const type of model.types) {
    if (names.has(type.name) || reservedNames.has(type.name))
      report(
        type.origin,
        type.id,
        `Rust declaration ${type.name} collides with another generated declaration`,
      );
    names.add(type.name);
    if (helpers.has(snake(type.name)))
      report(type.origin, type.id, "Rust snake-case codec names must be unique");
    helpers.add(snake(type.name));
    const members = new Set(["try_new", "into_parts"]);
    for (const field of type.kind === "object" ? type.fields : []) {
      if (members.has(snake(field.name)))
        report(
          field.origin,
          `${type.id}.${field.name}`,
          "Rust member accessor collides with another generated member",
        );
      members.add(snake(field.name));
    }
  }
  for (const type of model.types.filter((candidate) => candidate.kind === "union"))
    if (names.has(`${type.name}Case`))
      report(
        type.origin,
        type.id,
        `Rust union case declaration ${type.name}Case collides with another generated declaration`,
      );
}

/** Case names that Rust reserves
 * @param type - Resolved declaration
 * @param report - Issue sink
 */
function checkSelf(type: ContractType, report: Report): void {
  const cases = type.kind === "union" ? type.variants : type.kind === "enum" ? type.members : [];
  if (cases.some((entry) => entry.name === "Self"))
    report(type.origin, type.id, "The Rust-reserved Self case name requires another portable name");
}

/** Union cases whose payload cannot carry the discriminator Rust checks at construction
 * @param model - Complete normalized contract
 * @param report - Issue sink
 */
function checkUnions(model: ContractModel, report: Report): void {
  const nodes = new Map(model.types.map((type) => [type.id, type]));
  for (const type of model.types) {
    if (type.kind !== "union") continue;
    for (const variant of type.variants) {
      const payload = nodes.get(variant.type.id);
      const field =
        payload?.kind === "object"
          ? payload.fields.find((candidate) => candidate.wireName === type.discriminator)
          : undefined;
      if (!field || field.optional || field.type.nullable || variant.type.nullable)
        report(
          variant.origin,
          type.id,
          "A union case requires a nonnullable object with a required nonnullable discriminator field",
        );
    }
  }
}

/** Scalar representations Rust cannot keep faithfully
 * @param type - Resolved scalar
 * @param nodes - Declarations by identity
 * @param report - Issue sink
 */
function checkScalar(
  type: ScalarType,
  nodes: ReadonlyMap<string, ContractType>,
  report: Report,
): void {
  const role = type.role === null ? undefined : nodes.get(type.role);
  if (
    type.role !== null &&
    (role?.kind !== "scalar" || role.role !== role.id || role.scalar !== type.scalar)
  )
    report(
      type.origin,
      type.id,
      "Nominal role must resolve to its own-role ancestor with the same scalar representation",
    );
  if (Object.values(type.encodings).includes("unixTimestamp"))
    report(
      type.origin,
      type.id,
      "Unix timestamp encoding cannot preserve the full year-zero and leap-second lexical date profile; select RFC3339 for this scalar",
    );
  if (type.preserveLexical && spellingless.has(type.scalar))
    report(
      type.origin,
      type.id,
      "Lexical retention requires a numeric or textual source spelling; boolean and binary values have none",
    );
}

/** Patterns and numeric unix-timestamp uses outside the Rust subset
 * @param uses - Every type use of the contract
 * @param nodes - Declarations by identity
 * @param report - Issue sink
 */
function checkUses(
  uses: readonly TypeUse[],
  nodes: ReadonlyMap<string, ContractType>,
  report: Report,
): void {
  for (const use of uses) {
    if (!nodes.has(use.id))
      report(
        use.origin,
        use.id,
        "Resolved Rust type reference is absent from the normalized model",
      );
    if (use.encodings && Object.values(use.encodings).includes("unixTimestamp"))
      report(
        use.origin,
        use.id,
        "Unix timestamp use-site encoding cannot retain the required lexical temporal profile",
      );
    if (use.constraints.pattern !== undefined && rustPattern(use.constraints.pattern) === undefined)
      report(
        use.origin,
        use.id,
        "The expression exceeds the faithfully translated Rust Unicode ECMAScript pattern subset",
      );
  }
}

/** Every type use declared by types and operation results
 * @param model - Complete normalized contract
 * @returns Uses in declaration order
 */
function allUses(model: ContractModel): TypeUse[] {
  const fromTypes = model.types.flatMap((type) =>
    type.kind === "object"
      ? type.fields.map((field) => field.type)
      : type.kind === "array"
        ? [type.element]
        : type.kind === "union"
          ? type.variants.map((variant) => variant.type)
          : [],
  );
  return [
    ...fromTypes,
    ...model.operations.flatMap((operation) =>
      operation.outcomes.flatMap((outcome) => (outcome.type ? [outcome.type] : [])),
    ),
  ];
}

/** Model meanings that cannot be silently weakened by Rust storage
 * @param model - Complete normalized contract
 * @param prefix - Requested Cargo package prefix
 * @returns Source-addressed generation violations
 */
export function rustIssues(model: ContractModel, prefix: string): GenerationIssue[] {
  const result: GenerationIssue[] = [];
  const report: Report = (origin, subject, reason) => {
    result.push({ code: "rust-unsupported", target: "rust", origin, subject, reason });
  };
  const nodes = new Map(model.types.map((type) => [type.id, type]));
  checkUses(allUses(model), nodes, report);
  if (result.length > 0) return result;
  checkNames(model, prefix, report);
  checkUnions(model, report);
  checkOperationNames(model, report);
  for (const type of model.types) {
    checkSelf(type, report);
    if (type.kind === "scalar") checkScalar(type, nodes, report);
    const pattern = "constraints" in type ? type.constraints.pattern : undefined;
    if (pattern !== undefined && rustPattern(pattern) === undefined)
      report(
        type.origin,
        type.id,
        "The expression exceeds the faithfully translated Rust Unicode ECMAScript pattern subset",
      );
  }
  for (const operation of model.operations) checkHttp(operation, nodes, report);
  checkDefaults(model, report);
  return result;
}
