import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server, type ServerResponse } from "node:http";
import * as C from "./contract.js";
import type { Check } from "./check.js";
import { createFetchTransport, createHttpClient, createIpcClient } from "./client.js";
import { accepted, processTransport, type Values } from "./consumer-fixture.js";

/**
 * Loopback server and its release
 * @param handler - Request listener
 * @returns Listening server, origin and deterministic close
 */
async function listen(
  handler: Parameters<typeof createServer>[1],
): Promise<{ readonly baseUrl: string; close(): Promise<void> }> {
  const server: Server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing peer address");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

/**
 * Cancellation of a request that never receives a response
 * @param fixture - Accepted values
 * @param reasonName - DOMException name used as the abort reason
 * @returns Completion after the call rejected with the reason
 */
async function cancelPending(fixture: Values, reasonName: string): Promise<void> {
  const pending = await listen(() => {});
  let timer: NodeJS.Timeout | undefined;
  try {
    const controller = new AbortController();
    const reason = new DOMException("host termination", reasonName);
    const client = createHttpClient({
      baseUrl: pending.baseUrl,
      transport: createFetchTransport(fetch),
    });
    const result = client.submit(fixture.input)(
      undefined,
      controller.signal,
      Date.now() + 10000,
    ).promise;
    const observed = assert.rejects(result, (error) => error === reason);
    await new Promise((resolve) => setTimeout(resolve, 50));
    if (reasonName === "TimeoutError") timer = setTimeout(() => controller.abort(reason), 10);
    else controller.abort(reason);
    await observed;
  } finally {
    clearTimeout(timer);
    await pending.close();
  }
}

/** Request that reached a recording server */
interface Received {
  readonly url: string | undefined;
  readonly body: string;
}

/**
 * Loopback server that records every complete request before answering it
 * @param answer - Writes the response to the request of the given path
 * @returns Origin, the requests received so far and deterministic close
 */
async function recording(
  answer: (url: string | undefined, response: ServerResponse) => void,
): Promise<{
  readonly baseUrl: string;
  readonly received: readonly Received[];
  close(): Promise<void>;
}> {
  const received: Received[] = [];
  const server = await listen((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ url: request.url, body: Buffer.concat(chunks).toString() });
      answer(request.url, response);
    });
  });
  return { baseUrl: server.baseUrl, received, close: () => server.close() };
}

/**
 * Declared created result of the submit operation
 * @param response - Response to write
 */
function created(response: ServerResponse): void {
  response.writeHead(201, { "content-type": "application/json" });
  response.end('{"value":"3"}');
}

/**
 * Redirect answer
 * @param response - Response to write
 * @param status - Redirect status
 * @param location - Location header value
 */
function redirect(response: ServerResponse, status: number, location: string): void {
  response.writeHead(status, { location });
  response.end();
}

/**
 * Submit call that must end as a contract defect because the answer is an undeclared redirect
 * @param fixture - Accepted values
 * @param baseUrl - Origin the call is configured for
 * @returns Rejection of the awaited call, absent when the call returned a result
 */
async function submitRejection(fixture: Values, baseUrl: string): Promise<unknown> {
  const client = createHttpClient({ baseUrl, transport: createFetchTransport(fetch) });
  return await client
    .submit(fixture.input)(undefined, new AbortController().signal, Infinity)
    .promise.then(
      () => undefined,
      (error: unknown) => error,
    );
}

/** Redirect statuses that the Fetch standard follows by default */
const followedStatuses = [301, 302, 303, 307, 308] as const;

/**
 * Connection-level guarantees over real sockets and a separate process
 * @param fixture - Accepted values
 * @returns Named checks
 */
export function networkChecks(fixture: Values): readonly Check[] {
  const signal = new AbortController().signal;
  return [
    [
      "http-body-truncated-by-the-peer-is-a-communication-failure",
      async () => {
        const truncated = await listen((_request, response) => {
          response.writeHead(201, { "content-type": "application/json", "content-length": "1000" });
          response.write('{"value":');
          setImmediate(() => response.destroy());
        });
        try {
          const client = createHttpClient({
            baseUrl: truncated.baseUrl,
            transport: createFetchTransport(fetch),
          });
          const result = await client.submit(fixture.input)(undefined, signal, Infinity);
          assert.equal(
            result.isErr() && "kind" in result.error && result.error.kind,
            "communication",
          );
        } finally {
          await truncated.close();
        }
      },
    ],
    [
      "http-cross-origin-redirect-never-reaches-the-other-origin",
      async () => {
        for (const status of followedStatuses) {
          const target = await recording((_url, response) => created(response));
          const source = await recording((_url, response) =>
            redirect(response, status, `${target.baseUrl}/leak`),
          );
          try {
            const rejection = await submitRejection(fixture, source.baseUrl);
            assert.deepEqual(target.received, [], `status ${status} reached the other origin`);
            assert.equal(source.received.length, 1, `status ${status}`);
            assert.notEqual(source.received[0]?.body, "", `status ${status} carried a body`);
            assert.ok(rejection instanceof C.ContractDefect, `status ${status}`);
          } finally {
            await source.close();
            await target.close();
          }
        }
      },
    ],
    [
      "http-same-origin-redirect-is-not-followed-and-is-a-contract-defect",
      async () => {
        for (const status of followedStatuses) {
          const origin = await recording((url, response) =>
            url === "/elsewhere" ? created(response) : redirect(response, status, "/elsewhere"),
          );
          try {
            const rejection = await submitRejection(fixture, origin.baseUrl);
            assert.deepEqual(
              origin.received.map((request) => request.url),
              ["/submit"],
              `status ${status} was followed`,
            );
            assert.ok(rejection instanceof C.ContractDefect, `status ${status}`);
          } finally {
            await origin.close();
          }
        }
      },
    ],
    [
      "http-abort-error-cancellation-rejects-with-the-host-reason",
      () => cancelPending(fixture, "AbortError"),
    ],
    [
      "http-timeout-error-cancellation-rejects-with-the-host-reason",
      () => cancelPending(fixture, "TimeoutError"),
    ],
    [
      "ipc-separate-process-applies-the-default-and-explicit-limits",
      async () => {
        const peer = processTransport();
        try {
          let calls = 0;
          const client = createIpcClient({
            transport: {
              request(command, parametersJson, context) {
                calls++;
                return peer.transport.request(command, parametersJson, context);
              },
            },
          });
          const forged = {
            input: { ...fixture.value, requestId: "not-a-uuid" },
            secret: { private: "never retain" },
          } as unknown as C.SubmitInput;
          await assert.rejects(
            async () => await client.submit(forged)(undefined, signal, Infinity),
            C.ContractDefect,
          );
          assert.equal(calls, 0);
          const defaulted = await client.submit(fixture.input)(undefined, signal, 77777);
          assert.equal(
            defaulted.isOk() && defaulted.value.case !== "Completed" && defaulted.value.value.value,
            "3",
          );
          const explicit = await client.submit(fixture.explicitInput)(undefined, signal, 88888);
          assert.equal(
            explicit.isOk() && explicit.value.case !== "Completed" && explicit.value.value.value,
            "2",
          );
        } finally {
          await peer.close();
        }
      },
    ],
    [
      "ipc-separate-process-returns-empty-bytes",
      async () => {
        const peer = processTransport();
        try {
          const downloaded = await createIpcClient({ transport: peer.transport }).download(
            accepted(C.DownloadInput.create({})),
          )(undefined, signal, Infinity);
          assert.equal(downloaded.isOk() && downloaded.value.value.length, 0);
        } finally {
          await peer.close();
        }
      },
    ],
  ];
}
