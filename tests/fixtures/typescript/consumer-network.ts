import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
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
          const client = createIpcClient({ transport: peer.transport });
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
