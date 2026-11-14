import { AsyncResult, Ok, type Result } from "ts-results-es";
import { expect, test } from "vite-plus/test";
import { loadGenerated, type LoadedContract } from "./load-generated.js";
import { recursiveModel } from "./stack-safe-model.fixture.js";

/** Rejected observations of an exercised public boundary */
interface Rejection {
  readonly violations: readonly { readonly path: string; readonly rule: string }[];
  readonly diagnostics: readonly { readonly path: string; readonly key: string }[];
}
/** Public canonical completion */
type Accepted = Result<
  { readonly value: unknown; readonly diagnostics: Rejection["diagnostics"] },
  Rejection
>;
/** Public codec surface exercised independently of private traversal */
interface Codec {
  create(value: unknown): Accepted;
  fromWire(value: unknown): Accepted;
  decode(text: string): Accepted;
  encode(value: unknown): Result<string, unknown>;
  toWire(value: unknown): Result<unknown, unknown>;
}
/** Generated effect invocation */
type Run<T> = (env: undefined, signal: AbortSignal, deadlineAt: number) => AsyncResult<T, unknown>;

/** Executed generated modules using installed production dependencies */
const generated: LoadedContract = loadGenerated(recursiveModel);

/**
 * Public generated codec lookup
 * @param name - Declaration name
 * @returns Codec of the declaration
 */
function codec(name: string): Codec {
  return generated.contract[name] as Codec;
}

/**
 * Independently assembled deep local value
 * @param kind - Recursive declaration shape
 * @param depth - Number of recursive edges
 * @returns Unvalidated local candidate
 */
function candidate(kind: "Node" | "Nest" | "Choice", depth: number): unknown {
  let value: unknown = kind === "Nest" ? [] : kind === "Choice" ? { kind: "link" } : {};
  for (let index = 0; index < depth; index++) {
    value =
      kind === "Nest"
        ? [value]
        : kind === "Choice"
          ? { kind: "link", next: value }
          : { next: value };
  }
  return value;
}

/**
 * Independently assembled exact document
 * @param kind - Recursive declaration shape
 * @param depth - Number of recursive edges
 * @returns Complete JSON text
 */
function document(kind: "Node" | "Nest" | "Choice", depth: number): string {
  if (kind === "Nest") return "[".repeat(depth + 1) + "]".repeat(depth + 1);
  return (
    (kind === "Choice" ? '{"kind":"link","next":' : '{"next":').repeat(depth) +
    (kind === "Choice" ? '{"kind":"link"}' : "{}") +
    "}".repeat(depth)
  );
}

/**
 * Iterative depth observation without recursive test assertions
 * @param value - Accepted or binding value
 * @param kind - Recursive shape
 * @returns Number of recursive edges
 */
function depthOf(value: unknown, kind: "Node" | "Nest" | "Choice"): number {
  let depth = 0;
  let current = value;
  for (;;) {
    const next =
      kind === "Nest" ? (current as unknown[])[0] : (current as Record<string, unknown>)["next"];
    if (next === undefined) return depth;
    current = next;
    depth++;
  }
}

for (const kind of ["Node", "Nest", "Choice"] as const) {
  for (const depth of [64, 128, 1000, 20_000]) {
    test(`${kind} completes all public codec entrypoints at depth ${depth}`, () => {
      const value = candidate(kind, depth);
      const text = document(kind, depth);
      for (const accepted of [
        codec(kind).create(value),
        codec(kind).fromWire(value),
        codec(kind).decode(text),
      ]) {
        expect(accepted.isOk()).toBe(true);
        const completed = accepted.unwrap().value;
        expect(depthOf(completed, kind)).toBe(depth);
        expect(Object.isFrozen(completed)).toBe(true);
        expect(codec(kind).create(completed).unwrap().value).toBe(completed);
        expect(codec(kind).encode(completed).unwrap()).toBe(text);
        const wire = codec(kind).toWire(completed).unwrap();
        expect(Object.is(wire, completed)).toBe(false);
        expect(depthOf(wire, kind)).toBe(depth);
        expect(codec(kind).fromWire(wire).isOk()).toBe(true);
      }
    });
  }
}

test("deep semantic failures retain precise paths without publishing a partial root", () => {
  const depth = 20_000;
  for (const kind of ["Node", "Nest", "Choice"] as const) {
    const prefix =
      kind === "Nest" ? "[" : kind === "Choice" ? '{"kind":"link","next":' : '{"next":';
    const suffix = kind === "Nest" ? "]" : "}";
    const rejected = codec(kind).decode(prefix.repeat(depth) + "null" + suffix.repeat(depth));
    const path = (kind === "Nest" ? "/0" : "/next").repeat(depth);
    expect(rejected.unwrapErr()).toEqual({ violations: [{ path, rule: "null" }], diagnostics: [] });
    expect(codec(kind).decode(document(kind, 0)).isOk()).toBe(true);
  }
});

test("declared cycles reject while unknown getters and cycles are never traversed", () => {
  const input: Record<string, unknown> = {};
  input["ignored"] = input;
  Object.defineProperty(input, "getter", {
    enumerable: true,
    get: () => {
      throw new Error("unknown getter invoked");
    },
  });
  const accepted = codec("Node").create(input).unwrap();
  expect(accepted.diagnostics).toEqual([
    { path: "", key: "ignored" },
    { path: "", key: "getter" },
  ]);
  expect(codec("Node").encode(accepted.value).unwrap()).toBe("{}");
  input["next"] = input;
  expect(codec("Node").create(input).unwrapErr()).toEqual({
    violations: [{ path: "/next", rule: "type" }],
    diagnostics: accepted.diagnostics,
  });
  expect(codec("Node").create({}).isOk()).toBe(true);
});

test("DAG occurrences retain independent wire ownership and accepted children are reused", () => {
  const child = codec("Node").create({ next: {} }).unwrap().value;
  const completed = codec("Pair").create({ left: child, right: child }).unwrap().value as Record<
    string,
    unknown
  >;
  expect(completed["left"]).toBe(child);
  expect(completed["right"]).toBe(child);
  const wire = codec("Pair").toWire(completed).unwrap() as Record<string, unknown>;
  expect(wire["left"]).not.toBe(wire["right"]);
  expect(codec("Pair").encode(completed).unwrap()).toBe('{"left":{"next":{}},"right":{"next":{}}}');
  const shared = { next: {} };
  expect(codec("Pair").create({ left: shared, right: shared }).isOk()).toBe(true);
  const array = codec("Nest").create([[]]).unwrap().value;
  expect(codec("Narrow").create({ items: array }).unwrapErr().violations).toEqual([
    { path: "/items", rule: "maxItems" },
  ]);
});

test("deep provider defaults use effective provenance and never repair null", () => {
  const accept = generated.contract["acceptMeasure"] as (input: unknown) => Accepted;
  const ordinary = codec("Payload")
    .create({ node: candidate("Node", 20_000), nest: [], choice: { kind: "link" } })
    .unwrap().value;
  const effective = accept(ordinary).unwrap().value as Record<string, unknown>;
  let current = effective["node"] as Record<string, unknown>;
  for (let depth = 0; depth <= 20_000; depth++) {
    expect(current["label"]).toBe("default");
    if (depth < 20_000) current = current["next"] as Record<string, unknown>;
  }
  expect(accept(effective).unwrap().value).toBe(effective);
  expect(
    accept({ node: { label: null }, nest: [], choice: { kind: "link" } }).unwrapErr().violations,
  ).toEqual([{ path: "/node/label", rule: "null" }]);
  expect(
    accept({ node: { label: undefined }, nest: [], choice: { kind: "link" } }).unwrapErr()
      .violations,
  ).toEqual([{ path: "/node/label", rule: "undefined" }]);
});

/**
 * Actual generated HTTP provider with byte collection at the host boundary
 * @param handlers - Canonical operation implementations
 * @returns Executed provider
 */
function provider(handlers: unknown): {
  handleHttp(request: Request): Run<{ readonly value: Response }>;
} {
  const create = generated.provider["createProvider"] as (
    handlers: unknown,
    readBody: unknown,
  ) => { handleHttp(request: Request): Run<{ readonly value: Response }> };
  return create(
    handlers,
    (request: Request) =>
      new AsyncResult(request.arrayBuffer().then((buffer) => Ok(new Uint8Array(buffer)))),
  );
}

test("actual generated HTTP provider and client process deep object array and union inputs", async () => {
  let calls = 0;
  const handlers = {
    measure:
      (input: Record<string, unknown>): Run<unknown> =>
      () => {
        calls++;
        const count =
          depthOf(input["node"], "Node") +
          depthOf(input["nest"], "Nest") +
          depthOf(input["choice"], "Choice");
        const value = codec("Count").create(count).unwrap().value;
        return new AsyncResult(Promise.resolve(Ok({ case: "Measured", value })));
      },
  };
  const served = provider(handlers);
  const signal = new AbortController().signal;
  let sends = 0;
  const createClient = generated.client["createHttpClient"] as (options: unknown) => {
    measure(input: unknown): Run<{ readonly case: string; readonly value: number }>;
  };
  const client = createClient({
    baseUrl: "http://localhost",
    transport: {
      request: (request: Request) => {
        sends++;
        return served
          .handleHttp(request)(undefined, signal, Infinity)
          .map((accepted) => accepted.value);
      },
      readBody: (response: Response) =>
        new AsyncResult(response.arrayBuffer().then((buffer) => Ok(new Uint8Array(buffer)))),
    },
  });
  const input = codec("Payload")
    .create({
      node: candidate("Node", 20_000),
      nest: candidate("Nest", 20_000),
      choice: candidate("Choice", 20_000),
    })
    .unwrap().value;
  const result = await client.measure(input)(undefined, signal, Infinity);
  expect(result.unwrap()).toEqual({ case: "Measured", value: 60_000 });
  expect(calls).toBe(1);
  expect(sends).toBe(1);
});
