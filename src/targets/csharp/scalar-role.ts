import type { Constraints, ScalarType } from "../../model/contract-model.js";
import type { CSharpContext } from "./context.js";
import { doc } from "./docs.js";
import { lines, name } from "./naming.js";

/** Scalar meanings whose zero value can be a valid contract value */
const zeroCapable: Readonly<Record<string, true>> = {
  boolean: true,
  int32: true,
  int64: true,
  uint64: true,
  integer: true,
  float32: true,
  float64: true,
};

/** Sign of an exact decimal spelling
 * @param text - JSON numeric token
 * @returns Negative one, zero or one
 */
function sign(text: string): number {
  if (/^[-+]?0*(?:\.0*)?$/.test(text.split(/[eE]/)[0]!)) return 0;
  return text.startsWith("-") ? -1 : 1;
}

/** Whether zero satisfies both numeric boundaries
 * @param rules - Normalized restrictions
 * @returns Zero membership of the declared range
 */
function rangeAcceptsZero(rules: Constraints): boolean {
  const { minimum, maximum } = rules;
  const lowerOk =
    minimum === undefined ||
    sign(minimum.value) < 0 ||
    (sign(minimum.value) === 0 && !minimum.exclusive);
  const upperOk =
    maximum === undefined ||
    sign(maximum.value) > 0 ||
    (sign(maximum.value) === 0 && !maximum.exclusive);
  return lowerOk && upperOk;
}

/** Whether the language default of the storage is a valid contract value
 * @param node - Scalar node
 * @returns Validity of the uninitialized state
 */
function defaultIsValid(node: ScalarType): boolean {
  return zeroCapable[node.scalar] === true && rangeAcceptsZero(node.constraints);
}

/** Initialization marker needed to tell an invalid default from an explicit value
 * @param c - Target context
 * @param node - Role root scalar
 * @returns Whether a separate flag is stored
 */
export function needsInitializationFlag(c: CSharpContext, node: ScalarType): boolean {
  const storage = c.storage(node);
  const selfDescribing =
    storage === "string" || storage === "ExactDecimal" || storage === "ImmutableArray<byte>";
  return !defaultIsValid(node) && !selfDescribing;
}

/** Expression that tells whether a role value was constructed
 * @param c - Target context
 * @param node - Role root scalar
 * @returns Boolean expression over `_value` and `_initialized`
 */
function initializedExpression(c: CSharpContext, node: ScalarType): string {
  const storage = c.storage(node);
  if (storage === "string") return "_value is not null";
  if (storage === "ExactDecimal") return "_value.IsInitialized";
  if (storage === "ImmutableArray<byte>") return "!_value.IsDefault";
  return needsInitializationFlag(c, node) ? "_initialized" : "true";
}

/** Role struct with private storage and a validated factory
 * @param c - Target context
 * @param node - Role root scalar whose role is its own identity
 * @returns Struct declaration
 */
export function roleDeclaration(c: CSharpContext, node: ScalarType): string {
  const storage = c.storage(node);
  const t = c.type(node.id);
  const flag = needsInitializationFlag(c, node);
  const self = name(node.name);
  return lines(
    doc(node.description || `Nominal ${node.name} role distinct from every other role`),
    `public readonly struct ${self} {`,
    doc("Role storage"),
    `private readonly ${storage} _value;`,
    flag && doc("Construction marker"),
    flag && "private readonly bool _initialized;",
    doc("Validated role completion", [["value", "Validated primitive"]]),
    `private ${self}(${storage} value) { _value = value; ${flag ? "_initialized = true;" : ""} }`,
    doc("Role construction state", [], undefined, {
      value: "Whether the role was constructed or its default is valid",
    }),
    `public bool IsInitialized => ${initializedExpression(c, node)};`,
    doc("Validated primitive access", [], undefined, {
      value: "Role representation",
      throws: [["InvalidOperationException", "Access to an uninitialized role"]],
    }),
    `public ${storage} Value => IsInitialized ? _value : throw new InvalidOperationException("Uninitialized ${node.name}");`,
    doc(
      "Constrained role construction",
      [["value", "Candidate primitive"]],
      "Role or positioned violations",
    ),
    `public static Result<Accepted<${t}>, ContractFailure> Create(${storage} value) => ${c.codec(node.id)}.Create(value);`,
    doc(
      "Validated role completion shared by construction and decoding",
      [["value", "Validated primitive"]],
      "Completed role",
    ),
    `internal static ${t} Complete(${storage} value) => new(value);`,
    "}",
  );
}
