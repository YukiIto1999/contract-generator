import type {
  ArrayType,
  ContractType,
  Field,
  ObjectType,
  Operation,
  TypeUse,
  UnionType,
} from "../../model/contract-model.js";
import { defaulted } from "./accepting.js";
import { node, type RustContext } from "./context.js";
import { defaultValue } from "./defaults.js";
import { doc, key, snake, stem } from "./naming.js";
import { tuplePermission } from "./render-object.js";
import { fieldType } from "./storage.js";

/** Whether provider acceptance must rebuild the declaration a use refers to
 * @param ctx - Rendering context
 * @param use - Resolved use
 * @returns True when a default is filled at some depth below the use
 */
function accepts(ctx: RustContext, use: TypeUse): boolean {
  return ctx.accepting.has(use.id);
}

/** Acceptance of one owned use value
 * @param ctx - Rendering context
 * @param use - Resolved use
 * @param expression - Identifier of the owned use value
 * @returns Rust expression of the use type with defaults applied below it
 */
function acceptUse(ctx: RustContext, use: TypeUse, expression: string): string {
  const call = `_accept_${key(node(ctx, use.id))}`;
  const boxed = ctx.boxed.has(use);
  if (use.nullable) return `${expression}.map(${boxed ? `|item| Box::new(${call}(*item))` : call})`;
  return boxed ? `Box::new(${call}(*${expression}))` : `${call}(${expression})`;
}

/** Function applying acceptance to an owned use value for an iterator or Option map
 * @param ctx - Rendering context
 * @param use - Resolved use
 * @returns Rust function path or closure
 */
function acceptMapper(ctx: RustContext, use: TypeUse): string {
  const call = `_accept_${key(node(ctx, use.id))}`;
  const boxed = ctx.boxed.has(use);
  if (!use.nullable) return boxed ? `|item| Box::new(${call}(*item))` : call;
  return boxed ? `|item| item.map(|inner| Box::new(${call}(*inner)))` : `|item| item.map(${call})`;
}

/** Statement applying defaults to one destructured field
 * @param ctx - Rendering context
 * @param field - Object field
 * @param stronger - Whether a defaulted field leaves its optional wrapper behind
 * @returns Rust statement rebinding `field_<name>`, or an empty string for an untouched field
 */
function fieldStatement(ctx: RustContext, field: Field, stronger: boolean): string {
  const name = `field_${snake(field.name)}`;
  if (defaulted(field)) {
    const fallback = defaultValue(ctx, field);
    const resolved = accepts(ctx, field.type)
      ? `match ${name} { Some(item) => ${acceptUse(ctx, field.type, "item")}, None => ${fallback} }`
      : `filled(${name}, || ${fallback})`;
    return `let ${name} = ${stronger ? resolved : `Some(${resolved})`};`;
  }
  if (!accepts(ctx, field.type)) return "";
  return field.optional
    ? `let ${name} = ${name}.map(${acceptMapper(ctx, field.type)});`
    : `let ${name} = ${acceptUse(ctx, field.type, name)};`;
}

/** Destructuring, default application and reconstruction of an object
 * @param ctx - Rendering context
 * @param type - Object declaration
 * @param target - Rust struct built from the processed members
 * @param stronger - Whether defaulted fields become required in the target
 * @returns Rust statements yielding the target value
 */
function rebuild(ctx: RustContext, type: ObjectType, target: string, stronger: boolean): string {
  const names = type.fields.map((field) => `field_${snake(field.name)}`);
  const members = type.fields.map((field, index) => `${snake(field.name)}: ${names[index]}`);
  return `let (${names.map((name) => `${name},`).join(" ")}) = value.into_parts();
    ${type.fields.map((field) => fieldStatement(ctx, field, stronger)).join("\n")}
    ${target} { ${members.join(", ")} }`;
}

/** Default application below an input-reachable object
 * @param ctx - Rendering context
 * @param type - Object declaration
 * @returns Rust private function
 */
function acceptObject(ctx: RustContext, type: ObjectType): string {
  return `/// Provider default application at every depth below ${type.name}
///
/// - value: accepted pre-default object
/// - Return: same object with every omitted defaulted member filled
fn _accept_${key(type)}(value: ${type.name}) -> ${type.name} {
    ${rebuild(ctx, type, type.name, false)}
}
`;
}

/** Default application inside every element of an array
 * @param ctx - Rendering context
 * @param type - Array declaration
 * @returns Rust private function
 */
function acceptArray(ctx: RustContext, type: ArrayType): string {
  const mapper = acceptMapper(ctx, type.element);
  return `/// Provider default application inside the elements of ${type.name}
///
/// - value: accepted pre-default collection
/// - Return: collection whose elements carry their defaults
fn _accept_${key(type)}(value: ${type.name}) -> ${type.name} {
    ${type.name}(value.into_vec().into_iter().map(${mapper}).collect())
}
`;
}

/** Default application inside the selected case of a union
 * @param ctx - Rendering context
 * @param type - Union declaration
 * @returns Rust private function
 */
function acceptUnion(ctx: RustContext, type: UnionType): string {
  const arms = type.variants.map((variant) => {
    const payload = accepts(ctx, variant.type)
      ? acceptUse(ctx, variant.type, "payload")
      : "payload";
    return `${type.name}Case::${variant.name}(payload) => ${type.name}(${type.name}Case::${variant.name}(${payload})),`;
  });
  return `/// Provider default application inside the selected case of ${type.name}
///
/// - value: accepted pre-default union
/// - Return: union whose payload carries its defaults
fn _accept_${key(type)}(value: ${type.name}) -> ${type.name} {
    match value.into_case() { ${arms.join("\n")} }
}
`;
}

/** Effective handler input without same-guarantee duplication
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Accepted provider input type
 */
export function acceptedType(ctx: RustContext, operation: Operation): string {
  const input = node(ctx, operation.input);
  return input.kind === "object" && input.fields.some(defaulted)
    ? `${stem(operation)}Accepted`
    : input.name;
}

/** Operation input whose own optional fields take provider defaults
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @param input - Input object
 * @returns Stronger effective input declaration with its acceptance function
 */
function strongerInput(ctx: RustContext, operation: Operation, input: ObjectType): string {
  const accepted = `${stem(operation)}Accepted`;
  const effective = (field: Field): string => fieldType(ctx, field, true);
  const members = input.fields.map(
    (field) =>
      `${doc(field.description, "Accepted effective handler member")}\n${snake(field.name)}: ${effective(field)},`,
  );
  const accessors = input.fields.map(
    (field) =>
      `/// Shared effective handler input\n///\n/// - self: accepted provider input\n/// - Return: stronger effective member presence\npub fn ${snake(field.name)}(&self) -> &${effective(field)} { &self.${snake(field.name)} }`,
  );
  const parts = input.fields.map((field) => `${effective(field)},`).join(" ");
  const moved = input.fields.map((field) => `self.${snake(field.name)},`).join(" ");
  return `
/// Provider-effective inputs after omission-only default application
#[derive(Debug, Clone, PartialEq)]
pub struct ${accepted} { ${members.join("\n")} }
impl ${accepted} {
${accessors.join("\n")}
/// Consuming effective input extraction
///
/// - self: accepted provider input
/// - Return: moved effective members
${[tuplePermission(input.fields.length), `pub fn into_parts(self) -> (${parts}) { (${moved}) }`].filter(Boolean).join("\n")}
}
/// Provider-only omission default application without redecoding children
///
/// - value: already accepted pre-default input
/// - Return: stronger effective input
pub fn accept_${snake(operation.name)}(value: ${input.name}) -> ${accepted} {
    ${rebuild(ctx, input, accepted, true)}
}`;
}

/** Acceptance entry point of one operation
 * @param ctx - Rendering context
 * @param operation - Canonical operation
 * @returns Rust declarations reachable from the generated provider
 */
function operationAcceptance(ctx: RustContext, operation: Operation): string {
  const input = node(ctx, operation.input);
  if (input.kind !== "object") return "";
  if (input.fields.some(defaulted)) return strongerInput(ctx, operation, input);
  const body = ctx.accepting.has(input.id) ? `_accept_${key(input)}(value)` : "value";
  return `/// Provider acceptance for inputs without a default on their own members
///
/// - value: accepted operation parameters
/// - Return: the parameters with nested provider defaults applied
pub fn accept_${snake(operation.name)}(value: ${input.name}) -> ${input.name} { ${body} }
`;
}

/** Private default application of one declaration below an operation input
 * @param ctx - Rendering context
 * @param type - Declaration
 * @returns Rust private function, or an empty string when the declaration needs none
 */
function acceptDeclaration(ctx: RustContext, type: ContractType): string {
  if (!ctx.accepting.has(type.id)) return "";
  const entry = ctx.model.operations.find((operation) => operation.input === type.id);
  switch (type.kind) {
    case "object":
      return entry !== undefined && type.fields.some(defaulted) ? "" : acceptObject(ctx, type);
    case "array":
      return acceptArray(ctx, type);
    case "union":
      return acceptUnion(ctx, type);
    case "scalar":
    case "enum":
    case "literal":
      return "";
  }
}

/** Provider-effective input declarations and default application at every depth
 * @param ctx - Generation context
 * @returns Rust acceptance functions and effective input declarations
 */
export function renderAcceptance(ctx: RustContext): string {
  const declarations = ctx.model.types.map((type) => acceptDeclaration(ctx, type)).join("");
  return (
    declarations +
    ctx.model.operations.map((operation) => operationAcceptance(ctx, operation)).join("\n")
  );
}
