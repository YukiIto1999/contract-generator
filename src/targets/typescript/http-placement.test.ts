import { AsyncResult, Ok, type Result } from "ts-results-es";
import { expect, test } from "vite-plus/test";
import { loadGenerated, type LoadedContract } from "./load-generated.js";
import { httpPlacementModel } from "./model-builders.js";

/** Request facts observed at the injected transport */
interface Seen {
  readonly url: string;
  readonly tag: string | null;
}

/** Callable Effect produced by the generated client */
type Run = (
  env: undefined,
  signal: AbortSignal,
  deadlineAt: number,
) => AsyncResult<unknown, unknown>;

/** Public construction of the generated lookup input */
interface LookupInputCodec {
  create(input: unknown): Result<{ readonly value: unknown }, unknown>;
}

/** Factory of the generated HTTP client */
type CreateClient = (options: unknown) => Record<string, (input: unknown) => Run>;

/** Call outcome with the requests that reached the transport */
interface Observation {
  readonly result: Result<unknown, unknown>;
  readonly seen: readonly Seen[];
}

/** Executed generated modules shared by every test of this file */
let loaded: LoadedContract | undefined;

/**
 * Executed generated modules
 * @returns Contract and client of the placement model
 */
function generated(): LoadedContract {
  loaded ??= loadGenerated(httpPlacementModel());
  return loaded;
}

/**
 * Lookup call over a transport that records every request and answers with a declared result
 * @param query - Query parameter text
 * @param tag - Header parameter text
 * @returns Call result and the requests the transport received
 */
async function lookup(query: string, tag: string): Promise<Observation> {
  const seen: Seen[] = [];
  const transport = {
    request: (request: Request) => {
      seen.push({ url: request.url, tag: request.headers.get("x-tag") });
      const reply = new Response('{"value":"found"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      return new AsyncResult(Promise.resolve(Ok(reply)));
    },
    readBody: (response: Response) =>
      new AsyncResult(response.arrayBuffer().then((buffer) => Ok(new Uint8Array(buffer)))),
  };
  // The modules are executed from source, so the test declares the exported shapes it calls.
  const codec = generated().contract["LookupInput"] as LookupInputCodec;
  const create = generated().client["createHttpClient"] as CreateClient;
  const input = codec.create({ q: query, tag });
  if (input.isErr()) throw new Error("fixture input");
  const run = create({ baseUrl: "http://localhost", transport })["lookup"]!(input.value.value);
  return { result: await run(undefined, new AbortController().signal, Infinity), seen };
}

test.each([
  ["a leading line feed", "\nvalue"],
  ["a trailing carriage return and line feed", "value\r\n"],
  ["an interior start-of-heading control", "a\u0001b"],
  ["an interior delete control", "a\u007fb"],
])("a header value with %s is a communication failure before the transport", async (_name, tag) => {
  const { result, seen } = await lookup("q", tag);
  expect(seen).toEqual([]);
  expect(result.isErr() && result.error).toMatchObject({ kind: "communication" });
});

test.each([
  ["an interior horizontal tab", "a\tb", "a\tb"],
  ["edge horizontal tabs, which are whitespace around the field value", "\tvalue\t", "value"],
])("a header value with %s is admissible", async (_name, tag, sent) => {
  const { result, seen } = await lookup("q", tag);
  expect(result.isOk()).toBe(true);
  expect(seen.map((request) => request.tag)).toEqual([sent]);
});

test("query text with control and reserved characters is encoded and never rejected", async () => {
  const { result, seen } = await lookup("a\r\nb\u0001\u007f c&d", "t");
  expect(result.isOk()).toBe(true);
  expect(seen.map((request) => request.url)).toEqual([
    "http://localhost/lookup?q=a%0D%0Ab%01%7F+c%26d",
  ]);
});
