import { AsyncResult, Ok } from "ts-results-es";
import { expect, test } from "vite-plus/test";
import { loadGenerated } from "./load-generated.js";
import { member, objectType, origin, outcome, scalarType } from "./model-builders.js";

/** Expected provider acceptance failure rather than handler rejection or defect */
interface InvalidInput {
  readonly kind: "invalid-input";
  readonly violations: readonly { readonly path: string; readonly rule: string }[];
}

/** Caller-owned deferred direct operation */
type Run = (
  env: unknown,
  signal: AbortSignal,
  deadlineAt: number,
) => AsyncResult<{ readonly case: "Done" }, InvalidInput>;

/** Direct provider surface exercised without transport effects */
interface Provider {
  save(input: unknown): Run;
}

test("invalid adversarial provider input never invokes the handler", async () => {
  const text = scalarType("Text", "string", { constraints: { pattern: "^(a+)+$" } });
  const input = objectType("Input", [member("value", text)]);
  const generated = loadGenerated({
    namespace: "T",
    name: "T",
    types: [text, input],
    operations: [
      {
        id: "T.save",
        name: "save",
        description: "",
        input: input.id,
        outcomes: [outcome("Done")],
        origin,
      },
    ],
  });
  const accepted: unknown[] = [];
  const handlers = {
    save: (value: unknown) => {
      accepted.push(value);
      return () => new AsyncResult(Promise.resolve(Ok({ case: "Done" as const })));
    },
  };
  const createProvider = generated.provider.createProvider as (
    handlers: unknown,
    readBody: unknown,
  ) => Provider;
  const provider = createProvider(
    handlers,
    (request: Request) =>
      new AsyncResult(request.arrayBuffer().then((buffer) => Ok(new Uint8Array(buffer)))),
  );
  const signal = new AbortController().signal;
  const rejected = await provider.save({ value: "a".repeat(16384) + "!" })({}, signal, Infinity);
  expect(rejected.isErr()).toBe(true);
  if (rejected.isErr()) expect(rejected.error).toMatchObject({ kind: "invalid-input" });
  expect(accepted).toEqual([]);
  const succeeded = await provider.save({ value: "a" })({}, signal, Infinity);
  expect(succeeded.isOk()).toBe(true);
  expect(accepted).toEqual([{ value: "a" }]);
  expect(Object.isFrozen(accepted[0])).toBe(true);
});
