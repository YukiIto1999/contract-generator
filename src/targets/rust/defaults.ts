import type { Constant, Field, TypeUse } from "../../model/contract-model.js";
import type { RustContext } from "./context.js";
import { planDefault, type DefaultChild } from "./default-plan.js";
import { useType } from "./storage.js";

/** Post-order task for finite typed default expansion */
type DefaultTask =
  | DefaultChild
  | {
      readonly kind: "finish";
      readonly use: TypeUse;
      readonly constant: Constant;
      readonly slot: number;
      readonly expression: () => string;
    };

/** Flat typed default construction with cycle rejection rather than a depth quota
 * @param ctx - Rendering context
 * @param use - Canonical root use
 * @param constant - Exact finite default value
 * @returns Rust statement expression or undefined for an unbuildable default
 */
function buildUse(ctx: RustContext, use: TypeUse, constant: Constant): string | undefined {
  const pending: DefaultTask[] = [{ kind: "visit", use, constant, slot: 0 }];
  const active = new Map<Constant, Set<string>>();
  const statements: string[] = [];
  let next = 1;
  while (pending.length > 0) {
    const task = pending.pop()!;
    if (task.kind === "finish") {
      active.get(task.constant)!.delete(task.use.id);
      const value = task.expression();
      statements.push(
        `let default_${task.slot}: ${useType(ctx, task.use)} = ${task.use.nullable ? `Some(${value})` : value};`,
      );
      continue;
    }
    const { use, constant, slot } = task;
    if (constant.kind === "null") {
      if (!use.nullable) return undefined;
      statements.push(`let default_${slot}: ${useType(ctx, use)} = None;`);
      continue;
    }
    let seen = active.get(constant);
    if (seen?.has(use.id)) return undefined;
    if (seen === undefined) {
      seen = new Set();
      active.set(constant, seen);
    }
    seen.add(use.id);
    const plan = planDefault(ctx, use, constant, next);
    if (plan === undefined) return undefined;
    const { expression, children } = plan;
    next += children.length;
    pending.push({ kind: "finish", use, constant, slot, expression });
    for (const child of children.reverse()) pending.push(child);
  }
  return `{ ${statements.join("\n")} default_0 }`;
}

/** Whether a field default can be built into storage without any run-time failure
 * @param ctx - Rendering context
 * @param field - Field carrying the default
 * @returns True when the default is absent or fits its declared storage
 */
export function buildable(ctx: RustContext, field: Field): boolean {
  return field.default === undefined || buildUse(ctx, field.type, field.default) !== undefined;
}

/** Typed default whose construction cannot fail at run time
 * @param ctx - Rendering context
 * @param field - Optional field with a default
 * @returns Rust expression of the field use type
 * @throws Error when the default does not fit its storage, which `buildable` rules out before rendering
 */
export function defaultValue(ctx: RustContext, field: Field): string {
  const value = field.default === undefined ? undefined : buildUse(ctx, field.type, field.default);
  if (value === undefined) throw new Error(`Unbuildable default for ${field.name}`);
  return value;
}
