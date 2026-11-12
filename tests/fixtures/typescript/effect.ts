import type { AsyncResult } from "ts-results-es";

/** Caller-owned execution identity unrelated to generated contracts */
const effectBrand: unique symbol = Symbol("FixtureEffect");
/** Adopted callable Effect supplied by the consumer
 * @typeParam Env - Execution capabilities
 * @typeParam E - Expected failures
 * @typeParam A - Successful value
 */
export type Effect<Env, E, A> = {
  (env: Env, signal: AbortSignal, deadlineAt: number): AsyncResult<A, E>;
  readonly [effectBrand]: true;
};
/** Consumer-owned deferred construction without invocation
 * @typeParam Env - Execution capabilities
 * @typeParam E - Expected failures
 * @typeParam A - Successful value
 * @param run - Execution-only thunk
 * @returns Branded callable without eager work
 */
export function deferEffect<Env, E, A>(
  run: (env: Env, signal: AbortSignal, deadlineAt: number) => AsyncResult<A, E>,
): Effect<Env, E, A> {
  const effect = (env: Env, signal: AbortSignal, deadlineAt: number) =>
    run(env, signal, deadlineAt);
  return Object.defineProperty(effect, effectBrand, { value: true }) as Effect<Env, E, A>;
}
