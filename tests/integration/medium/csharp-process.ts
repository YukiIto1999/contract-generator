import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { expect } from "vite-plus/test";
import { nativeTimeout } from "./csharp-toolchain.js";

/** Native driver execution over JSON lines; asynchronous so in-process raw peers keep answering while the driver runs
 * @param driver - Built driver assembly
 * @param requests - One JSON value per input line
 * @returns One parsed observation per request
 */
export async function runDriver(
  driver: string,
  requests: readonly unknown[],
): Promise<readonly Record<string, unknown>[]> {
  const child = spawn("dotnet", [driver], { stdio: ["pipe", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdin.on("error", () => undefined);
  child.stdin.end(requests.map((request) => JSON.stringify(request)).join("\n") + "\n");
  const timer = setTimeout(() => child.kill("SIGKILL"), nativeTimeout);
  const [status] = (await once(child, "close")) as [number | null];
  clearTimeout(timer);
  expect(status, Buffer.concat(stderr).toString("utf8")).toBe(0);
  const observations = Buffer.concat(stdout)
    .toString("utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(observations).toHaveLength(requests.length);
  return observations;
}

/** Exclusive loopback port selection
 * @returns A currently unused TCP port
 * @throws {@link Error} A listener without a numeric address
 */
export async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Unable to select a loopback port");
  server.close();
  await once(server, "close");
  return address.port;
}

/** Real generated provider behind a native HTTP listener */
export interface HttpServer {
  /** Listener origin ending in a slash */
  readonly origin: string;
  /** Child process owning the listener */
  readonly child: ChildProcess;
  /** Terminating and awaiting the child */
  stop(): Promise<void>;
}

/** Starting `OperationDriver --http-server` and waiting for its readiness line
 * @param driver - Built OperationDriver.dll path
 * @returns Running real server
 * @throws {@link Error} A server that exits or stays silent before readiness
 */
export async function startHttpServer(driver: string): Promise<HttpServer> {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}/`;
  const child = spawn("dotnet", [driver, "--http-server", origin], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const lines = createInterface({ input: child.stdout! });
  const failure = once(child, "exit").then(() => {
    throw new Error("native HTTP server exited before readiness");
  });
  const ready = once(lines, "line").then(([line]) => {
    if (line !== "ready") throw new Error(`unexpected readiness line: ${String(line)}`);
  });
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error("native HTTP server readiness timeout")),
      nativeTimeout,
    );
  });
  try {
    await Promise.race([ready, failure, expired]);
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  } finally {
    clearTimeout(timer);
  }
  failure.catch(() => undefined);
  lines.close();
  return {
    origin,
    child,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGTERM");
        await once(child, "exit");
      }
    },
  };
}

/** Outcome of the separate-process worker mode driven by a hand-written request line */
export interface WorkerRun {
  /** Process exit status */
  readonly status: number | null;
  /** Standard output with the resolved envelope line, if any */
  readonly stdout: string;
  /** Standard error with the host failure diagnostic, if any */
  readonly stderr: string;
}

/** Real worker process that dispatches a command through the generated provider
 * @param driver - Built OperationDriver.dll path
 * @param request - Command, parameters text and optional absolute deadline
 * @returns Process outcome
 */
export function runWorker(
  driver: string,
  request: { readonly command: string; readonly parameters: string; readonly deadline?: string },
): WorkerRun {
  const run = spawnSync("dotnet", [driver, "--ipc-worker"], {
    input: JSON.stringify(request) + "\n",
    encoding: "utf8",
    timeout: nativeTimeout,
  });
  expect(run.error).toBeUndefined();
  return { status: run.status, stdout: run.stdout, stderr: run.stderr };
}

/** One native HTTP exchange independent of the generated client
 * @param base - Server origin ending in a slash
 * @param method - HTTP method
 * @param path - Absolute request path
 * @param headers - Request headers
 * @param body - Optional request bytes
 * @returns Status, headers and body bytes
 */
export async function exchange(
  base: string,
  method: string,
  path: string,
  headers: Readonly<Record<string, string>> = {},
  body?: string,
): Promise<{
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly body: Buffer;
}> {
  return new Promise((resolve, reject) => {
    const outgoing = httpRequest(
      new URL(path, base),
      { method, headers, agent: false },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", reject);
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}

/** Media essence of an observed content-type header
 * @param value - Raw header value
 * @returns Lowercase type/subtype without parameters
 */
export function essence(value: string | undefined): string {
  return (value ?? "").split(";")[0]!.trim().toLowerCase();
}
