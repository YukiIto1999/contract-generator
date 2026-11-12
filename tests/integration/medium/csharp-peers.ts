import { once } from "node:events";
import { createServer, type Socket } from "node:net";

/** Listening raw TCP peer speaking hand-written HTTP/1.1 */
export interface RawPeer {
  /** Origin ending in a slash */
  readonly origin: string;
  /** Complete raw request bytes observed, one entry per connection */
  readonly requests: Buffer[];
  /** Closing the listener and every open connection */
  close(): Promise<void>;
}

/** Hand-written HTTP/1.1 response bytes independent of any HTTP library
 * @param status - Status code
 * @param headers - Exact header lines
 * @param body - Response body bytes
 * @param declaredLength - Content-Length override, or `null` to omit the header
 * @returns Complete response bytes
 */
export function httpResponse(
  status: number,
  headers: Readonly<Record<string, string>>,
  body: Buffer | string = "",
  declaredLength?: number | null,
): Buffer {
  const payload = Buffer.from(body);
  const lines = [
    `HTTP/1.1 ${status} Fixture`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
  ];
  if (declaredLength !== null) lines.push(`Content-Length: ${declaredLength ?? payload.length}`);
  lines.push("Connection: close", "", "");
  return Buffer.concat([Buffer.from(lines.join("\r\n"), "latin1"), payload]);
}

/** Starting a raw peer that answers one request per connection with fixed bytes
 * @param response - Complete bytes written after the request is fully received; an empty buffer closes without any response
 * @returns Running peer
 * @throws {@link Error} A listener without a numeric address
 */
export async function startRawPeer(response: Buffer): Promise<RawPeer> {
  const requests: Buffer[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    let received = Buffer.alloc(0);
    let answered = false;
    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);
      const headEnd = received.indexOf("\r\n\r\n");
      if (answered || headEnd < 0) return;
      const length = /^content-length:\s*(\d+)\s*$/im.exec(
        received.subarray(0, headEnd).toString("latin1"),
      );
      if (received.length < headEnd + 4 + (length === null ? 0 : Number(length[1]))) return;
      answered = true;
      requests.push(received);
      socket.end(response);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Unable to bind a raw peer");
  return {
    origin: `http://127.0.0.1:${address.port}/`,
    requests,
    async close() {
      for (const socket of sockets) socket.destroy();
      server.close();
      await once(server, "close");
    },
  };
}

/** Request line, headers and body split from raw request bytes
 * @param raw - Complete request bytes captured by a raw peer
 * @returns Parsed request independent of the client under test
 */
export function parseRawRequest(raw: Buffer): {
  readonly line: string;
  readonly headers: ReadonlyMap<string, string>;
  readonly body: Buffer;
} {
  const headEnd = raw.indexOf("\r\n\r\n");
  const [line = "", ...headerLines] = raw.subarray(0, headEnd).toString("latin1").split("\r\n");
  const headers = new Map(
    headerLines.map((header) => {
      const colon = header.indexOf(":");
      return [header.slice(0, colon).toLowerCase(), header.slice(colon + 1).trim()] as const;
    }),
  );
  return { line, headers, body: raw.subarray(headEnd + 4) };
}

/** Pool of raw peers closed together at the end of a suite */
export class PeerPool {
  /** Peers started so far */
  readonly peers: RawPeer[] = [];

  /** Raw peer origin serving fixed bytes
   * @param bytes - Complete hand-written response
   * @returns Peer origin
   */
  async origin(bytes: Buffer): Promise<string> {
    const peer = await startRawPeer(bytes);
    this.peers.push(peer);
    return peer.origin;
  }

  /** Closing every peer started through the pool */
  async close(): Promise<void> {
    for (const peer of this.peers) await peer.close();
  }
}
