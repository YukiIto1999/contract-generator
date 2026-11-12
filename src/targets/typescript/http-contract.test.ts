import { AsyncResult, Err, Ok, type Result } from "ts-results-es";
import { expect, test } from "vite-plus/test";
import { loadGenerated, type LoadedContract } from "./load-generated.js";
import { httpSampleModel } from "./model-builders.js";

/** Handler input observed by the fixture adapter */
interface PlaceInput {
  readonly id: string;
  readonly token: string;
  readonly note: string;
}

/** Callable Effect produced by the generated provider and client */
type Run<A> = (env: undefined, signal: AbortSignal, deadlineAt: number) => AsyncResult<A, unknown>;

/** Provider entrypoints used by the tests */
interface Provider {
  handleHttp(request: Request): Run<{
    readonly value: Response;
    readonly diagnostics: readonly { path: string; key: string }[];
  }>;
}

/** Client methods used by the tests */
type Client = Record<
  string,
  (
    input: unknown,
  ) => Run<{ readonly case: string; readonly value?: { toUint8Array(): Uint8Array } }>
>;

/** Transport shape of the generated client */
interface Transport {
  request(request: Request): AsyncResult<Response, unknown>;
  readBody(response: Response): AsyncResult<Uint8Array, unknown>;
}

/** Executed generated modules shared by every test of this file */
let loaded: LoadedContract | undefined;

/**
 * Executed generated modules
 * @returns Contract, client and provider of the sample model
 */
function generated(): LoadedContract {
  loaded ??= loadGenerated(httpSampleModel());
  return loaded;
}

/**
 * Handwritten adapter observing accepted inputs
 * @param observed - Accepted place inputs in call order
 * @returns Handlers of the sample contract
 */
function handlers(observed: PlaceInput[]): Record<string, unknown> {
  const reply = (value: unknown) => (): AsyncResult<unknown, unknown> =>
    new AsyncResult(Promise.resolve(Ok(value)));
  const contract = generated().contract;
  const codecOf = (name: string): { create(input: unknown): Result<{ value: unknown }, unknown> } =>
    contract[name] as { create(input: unknown): Result<{ value: unknown }, unknown> };
  const created = (name: string, input: unknown): unknown => {
    const accepted = codecOf(name).create(input);
    if (accepted.isErr()) throw new Error(`fixture ${name}`);
    return accepted.value.value;
  };
  return {
    place: (input: PlaceInput) => {
      observed.push(input);
      return reply({
        case: "Placed",
        value: created("Reply", { value: `${input.id}|${input.token}|${input.note}` }),
      });
    },
    ping: () => reply({ case: "Done" }),
    blobJson: () => reply({ case: "Loaded", value: created("Blob", new Uint8Array([1, 2, 3])) }),
    blobRaw: () => reply({ case: "Loaded", value: created("Blob", new Uint8Array([0, 255])) }),
  };
}

/**
 * Provider over the sample handlers
 * @param observed - Accepted place inputs in call order
 * @returns Executed provider
 */
function provider(observed: PlaceInput[] = []): Provider {
  const create = generated().provider["createProvider"] as (
    handlers: unknown,
    readBody: unknown,
  ) => Provider;
  const readBody = (request: Request): AsyncResult<Uint8Array, unknown> =>
    new AsyncResult(request.arrayBuffer().then((buffer) => Ok(new Uint8Array(buffer))));
  return create(handlers(observed), readBody);
}

/**
 * Client whose transport returns fixed responses
 * @param respond - Response of every request
 * @returns Executed HTTP client
 */
function clientOver(respond: (request: Request) => Promise<Response>): Client {
  const transport: Transport = {
    request: (request) => new AsyncResult(respond(request).then((response) => Ok(response))),
    readBody: (response) =>
      new AsyncResult(response.arrayBuffer().then((buffer) => Ok(new Uint8Array(buffer)))),
  };
  const create = generated().client["createHttpClient"] as (options: unknown) => Client;
  return create({ baseUrl: "http://localhost", transport });
}

/**
 * Client served by the generated provider in the same process
 * @returns Executed HTTP client over a loopback transport
 */
function loopback(): Client {
  const served = provider();
  return clientOver(async (request) => {
    const result = await served.handleHttp(request)(
      undefined,
      new AbortController().signal,
      Infinity,
    );
    if (result.isErr()) throw new Error("provider rejected the request");
    return result.value.value;
  });
}

/**
 * Result of a client call
 * @param client - Executed client
 * @param name - Operation name
 * @returns Awaited call result
 */
async function call(
  client: Client,
  name: string,
): Promise<
  Result<{ readonly case: string; readonly value?: { toUint8Array(): Uint8Array } }, unknown>
> {
  const method = client[name];
  if (method === undefined) throw new Error(`missing ${name}`);
  return await method({})(undefined, new AbortController().signal, Infinity);
}

test("a body member duplicating a placed parameter is dropped and reported as an unknown member", async () => {
  const observed: PlaceInput[] = [];
  const request = new Request("http://localhost/things/from-path", {
    method: "POST",
    headers: { "content-type": "application/json", "x-token": "from-header" },
    body: '{"id":"from-body","token":"from-body","note":"n","extra":1}',
  });
  const result = await provider(observed).handleHttp(request)(
    undefined,
    new AbortController().signal,
    Infinity,
  );
  expect(result.isOk()).toBe(true);
  expect(observed.map((input) => ({ id: input.id, token: input.token, note: input.note }))).toEqual(
    [{ id: "from-path", token: "from-header", note: "n" }],
  );
  const diagnostics = result.isOk() ? result.value.diagnostics : [];
  expect(diagnostics).toEqual([
    { path: "", key: "extra" },
    { path: "", key: "id" },
    { path: "", key: "token" },
  ]);
});

test("a body member duplicating an omitted placed parameter never fills it", async () => {
  const request = new Request("http://localhost/things/from-path", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"token":"from-body","note":"n"}',
  });
  const result = await provider().handleHttp(request)(
    undefined,
    new AbortController().signal,
    Infinity,
  );
  expect(result.isErr() && result.error).toMatchObject({ kind: "invalid-input" });
});

test("a bodyless result matches only a response without Content-Type and without body", async () => {
  const exact = await call(
    clientOver(async () => new Response(null, { status: 200 })),
    "ping",
  );
  expect(exact.isOk() && exact.value).toEqual({ case: "Done" });
});

test("a response with a Content-Type never matches a bodyless result", async () => {
  const client = clientOver(
    async () =>
      new Response(null, { status: 200, headers: { "content-type": "application/json" } }),
  );
  await expect(call(client, "ping")).rejects.toMatchObject({ name: "ContractDefect" });
});

test("a response with a body never matches a bodyless result", async () => {
  const client = clientOver(async () => new Response(new Uint8Array([1]), { status: 200 }));
  await expect(call(client, "ping")).rejects.toMatchObject({ name: "ContractDefect" });
});

test("bytes under a JSON media type travel as a JSON string in the binding encoding", async () => {
  const response = await provider().handleHttp(new Request("http://localhost/blobJson"))(
    undefined,
    new AbortController().signal,
    Infinity,
  );
  expect(response.isOk() && (await response.value.value.text())).toBe('"AQID"');
  const loopbackResult = await call(loopback(), "blobJson");
  expect(
    loopbackResult.isOk() && Array.from(loopbackResult.value.value?.toUint8Array() ?? []),
  ).toEqual([1, 2, 3]);
});

test("bytes under a non-JSON media type travel as the raw bytes", async () => {
  const response = await provider().handleHttp(new Request("http://localhost/blobRaw"))(
    undefined,
    new AbortController().signal,
    Infinity,
  );
  expect(
    response.isOk() && Array.from(new Uint8Array(await response.value.value.arrayBuffer())),
  ).toEqual([0, 255]);
  const loopbackResult = await call(loopback(), "blobRaw");
  expect(
    loopbackResult.isOk() && Array.from(loopbackResult.value.value?.toUint8Array() ?? []),
  ).toEqual([0, 255]);
});

test("an unknown route is a typed not-found result for the host to answer", async () => {
  const result = await provider().handleHttp(new Request("http://localhost/unknown"))(
    undefined,
    new AbortController().signal,
    Infinity,
  );
  expect(result.isErr() && result.error).toEqual({ kind: "not-found" });
});

test("the bundled Fetch transport forwards the signal, classifies network failures and rethrows defects", async () => {
  const create = generated().client["createFetchTransport"] as (fetcher: unknown) => {
    request(
      request: Request,
      context: { signal: AbortSignal; deadlineAt: number },
    ): AsyncResult<Response, unknown>;
  };
  const controller = new AbortController();
  const context = { signal: controller.signal, deadlineAt: 1 };
  const seen: (AbortSignal | undefined)[] = [];
  const network = create(async (_request: Request, init?: RequestInit) => {
    seen.push(init?.signal ?? undefined);
    throw new TypeError("fetch failed");
  });
  const failed = await network.request(new Request("http://localhost/"), context);
  expect(failed.isErr() && failed.error).toMatchObject({ kind: "communication" });
  expect(seen).toEqual([controller.signal]);
  const defect = new Error("host defect");
  const broken = create(async () => {
    throw defect;
  });
  await expect(broken.request(new Request("http://localhost/"), context)).rejects.toBe(defect);
  controller.abort(new DOMException("cancelled", "AbortError"));
  const aborted = create(async () => {
    controller.signal.throwIfAborted();
    return Err("unreachable");
  });
  await expect(aborted.request(new Request("http://localhost/"), context)).rejects.toBe(
    controller.signal.reason,
  );
});
