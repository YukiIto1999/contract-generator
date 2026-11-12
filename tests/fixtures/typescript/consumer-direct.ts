import assert from "node:assert/strict";
import * as C from "./contract.js";
import type { Check } from "./check.js";
import type { Values } from "./consumer-fixture.js";
import { provider, type Environment } from "./host.js";

/**
 * Direct-call and provider-side acceptance guarantees
 * @param fixture - Accepted values and their wire form
 * @param env - Adapter observations
 * @returns Named checks calling the generated provider in-process
 */
export function directChecks(fixture: Values, env: Environment): readonly Check[] {
  const signal = new AbortController().signal;
  const { value, wire, input, explicitInput } = fixture;
  return [
    [
      "direct-call-defers-until-run-and-applies-the-default",
      async () => {
        const before = env.limits.length;
        const direct = provider.submit(input);
        assert.equal(env.limits.length, before);
        const result = await direct(env, signal, 12345);
        assert.equal(result.isOk(), true);
        assert.equal(env.limits.at(-1), 3);
        assert.equal(env.deadlines.at(-1), 12345);
      },
    ],
    [
      "direct-call-explicit-value-wins-over-the-default",
      async () => {
        const result = await provider.submit(explicitInput)(env, signal, 23456);
        assert.equal(
          result.isOk() && result.value.case !== "Completed" && result.value.value.value,
          "2",
        );
      },
    ],
    [
      "direct-and-ipc-reject-null-and-out-of-range-limits-before-the-handler",
      async () => {
        for (const limit of [null, 4]) {
          const before = env.limits.length;
          const local = await provider.submit({ input: value, limit } as unknown as C.SubmitInput)(
            env,
            signal,
            Infinity,
          );
          assert.equal(local.isErr() && "kind" in local.error && local.error.kind, "invalid-input");
          const wireInput = JSON.stringify({ input: wire, limit });
          const ipc = await provider.handleIpc("submit", wireInput)(env, signal, Infinity);
          assert.equal(ipc.isErr() && ipc.error.kind, "invalid-input");
          assert.equal(env.limits.length, before);
        }
      },
    ],
    [
      "unknown-ipc-command-is-a-typed-not-found-result",
      async () => {
        const result = await provider.handleIpc("missing", "{}")(env, signal, Infinity);
        assert.deepEqual(result.isErr() && result.error, { kind: "not-found" });
      },
    ],
    [
      "malformed-ipc-parameters-are-a-typed-invalid-input-result",
      async () => {
        const result = await provider.handleIpc("submit", "{")(env, signal, Infinity);
        assert.equal(result.isErr() && result.error.kind, "invalid-input");
      },
    ],
  ];
}
