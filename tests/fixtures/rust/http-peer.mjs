import { createServer } from "node:net";

/** Explicit raw HTTP peer configuration without contract interpretation */
const config = JSON.parse(process.argv[2]);
/** Raw response bytes including intentional protocol interruption */
const response = Buffer.from(config.response ?? "", "base64");
/** Machine-readable observation of one peer event on stdout */
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
/** Actual loopback transport for native client fault observations */
const server = createServer((socket) => {
  emit({ connection: true });
  socket.on("error", () => {});
  let request = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    request = Buffer.concat([request, chunk]);
    const boundary = request.indexOf("\r\n\r\n");
    if (boundary < 0) return;
    const header = request.subarray(0, boundary).toString("ascii");
    const length = Number(/(?:^|\r\n)content-length:\s*(\d+)/i.exec(header)?.[1] ?? 0);
    if (request.length < boundary + 4 + length) return;
    socket.removeAllListeners("data");
    emit({ request: request.toString("base64") });
    if (config.stall !== true) socket.end(response);
  });
});
server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("native listening address");
  emit({ port: address.port });
});
