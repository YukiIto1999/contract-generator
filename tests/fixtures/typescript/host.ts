import { AsyncResult, Err, Ok, Result } from "ts-results-es";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import * as C from "./contract.js";
import { deferEffect } from "./effect.js";
import { createProvider, type Handlers, type RequestBodyReader } from "./provider.js";

/** Fixture environment observed by handwritten adapters */
export interface Environment {
  readonly limits: number[];
  readonly deadlines: number[];
}

/**
 * Error mapper of native request body failures
 * @param cause - Native I/O rejection
 * @returns Expected communication failure for network failures
 * @throws {@link Error} Cancellation and every other defect, unchanged
 */
function toCommunicationFailure(cause: unknown): C.CommunicationFailure {
  if (cause instanceof TypeError)
    return { kind: "communication", message: "inbound body read failed" };
  throw cause;
}

/** Actual inbound request body reader with typed native communication failures */
export const readRequestBody: RequestBodyReader = (request) =>
  new AsyncResult(
    Result.wrapAsync<Uint8Array, unknown>(
      async () => new Uint8Array(await request.arrayBuffer()),
    ).then((received) => received.mapErr(toCommunicationFailure)),
  );

/** Handwritten contract-side adapter using only generated acceptance and payload APIs */
export const handlers: Handlers<Environment> = {
  submit(input) {
    return deferEffect(
      (env: Environment, signal: AbortSignal, deadlineAt: number) =>
        new AsyncResult(
          (async (): Promise<Result<C.SubmitSuccess, C.SubmitRejection>> => {
            signal.throwIfAborted();
            env.limits.push(input.limit);
            env.deadlines.push(deadlineAt);
            if (input.input.label === "r") {
              const rejected = C.Rejected.create({ code: "invalid", message: "declared" });
              if (rejected.isErr()) throw new Error("Invalid fixture rejection");
              return Err({ case: "Rejected" as const, value: rejected.value.value });
            }
            if (input.input.label === "v") return Ok({ case: "Completed" as const });
            const receipt = C.Receipt.create({ value: String(input.limit) });
            if (receipt.isErr()) throw new Error("Invalid fixture receipt");
            return Ok({
              case: input.input.label === "q" ? ("Queued" as const) : ("Created" as const),
              value: receipt.value.value,
            });
          })(),
        ),
    );
  },
  download(_input) {
    return deferEffect((_env: Environment, signal: AbortSignal, _deadlineAt: number) => {
      signal.throwIfAborted();
      const value = C.IntrinsicBytes.create(new Uint8Array());
      if (value.isErr()) throw new Error("Invalid empty byte fixture");
      return new AsyncResult(Ok({ case: "Downloaded" as const, value: value.value.value }));
    });
  },
};
/** Real generated provider with adapter-owned environment */
export const provider = createProvider(handlers, readRequestBody);
/** Running native HTTP fixture ownership */
export interface HttpHost {
  readonly server: Server;
  readonly baseUrl: string;
}

/**
 * Complete native request body
 * @param incoming - Node request stream
 * @returns Concatenated body bytes
 */
async function collect(incoming: AsyncIterable<unknown>): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of incoming) chunks.push(Uint8Array.from(chunk as Uint8Array));
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Real socket host forwarding requests into generated HTTP dispatch; the host decides every error response
 * @param env - Adapter observations
 * @param override - Optional independently specified fault response
 * @returns Listening server and injected origin
 */
export async function startHttpHost(
  env: Environment,
  override?: (request: Request) => Response | undefined,
): Promise<HttpHost> {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const body = await collect(incoming);
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers))
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      const request = new Request(`http://127.0.0.1${incoming.url}`, {
        method: incoming.method!,
        headers,
        ...(body.length === 0 ? {} : { body }),
      });
      const response = override?.(request);
      const result = response
        ? Ok({ value: response, diagnostics: [] })
        : await provider.handleHttp(request)(env, new AbortController().signal, Infinity);
      if (result.isErr()) {
        const failure = result.error;
        outgoing.statusCode =
          failure.kind === "not-found" ? 404 : failure.kind === "invalid-input" ? 400 : 503;
        outgoing.end();
        return;
      }
      const served = result.value.value;
      outgoing.statusCode = served.status;
      served.headers.forEach((value, name) => outgoing.setHeader(name, value));
      outgoing.end(new Uint8Array(await served.arrayBuffer()));
    } catch (cause) {
      outgoing.destroy(cause instanceof Error ? cause : new Error(String(cause)));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing HTTP address");
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}
