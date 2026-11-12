import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository checkout owning the TypeSpec library and the contract fixtures */
export const repository = fileURLToPath(new URL("../../../../", import.meta.url));

/** One observed output line with exact source text */
export interface Line {
  readonly raw: string;
  readonly json: unknown;
}

/** Native child with exact startup observations */
export interface Peer {
  readonly child: ChildProcess;
  readonly origin: string;
  readonly stdout: Observed;
  readonly stderr: Observed;
}

/** Children started by the current test file, stopped once it ends */
const children: ChildProcess[] = [];

/** Checked member read from parsed JSON
 * @param value - Parsed JSON value
 * @param name - Member name
 * @returns Member value, or undefined when the value is not an object with that member
 */
export function field(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null && name in value
    ? Reflect.get(value, name)
    : undefined;
}

/** Actual wall-clock pause between polls of a separate native process; no event exists for its own file write
 * @param milliseconds - Wait duration
 * @returns Completion after the delay
 */
export function sleep(milliseconds: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, milliseconds);
  });
}

/** Completion of a child process
 * @param child - Native child
 * @returns Exit observation
 */
export function exited(child: ChildProcess): Promise<void> {
  return new Promise((done) => {
    child.once("exit", () => {
      done();
    });
  });
}

/** Line-oriented observations of a child's output file; a file never applies back-pressure while this process blocks on a synchronous native call */
export class Observed {
  constructor(private readonly path: string) {}

  /** Every complete or partial line written so far */
  get lines(): Line[] {
    return readFileSync(this.path, "utf8")
      .split("\n")
      .filter((raw) => raw !== "")
      .map((raw) => {
        let json: unknown = raw;
        try {
          json = JSON.parse(raw);
        } catch {
          /* non-JSON output is retained as text */
        }
        return { raw, json };
      });
  }

  /** Wait for one observed line selected by a predicate
   * @param predicate - Independently authored selector
   * @returns Raw and parsed line
   * @throws Error when no line matched within twenty seconds
   */
  async find(predicate: (line: Line) => boolean): Promise<Line> {
    const deadline = Date.now() + 20_000;
    for (;;) {
      const hit = this.lines.find(predicate);
      if (hit !== undefined) return hit;
      if (Date.now() > deadline)
        throw new Error(
          `observation not seen: ${JSON.stringify(this.lines.map((line) => line.raw))}`,
        );
      await sleep(25);
    }
  }
}

/** Native child whose output files are observed line by line
 * @param base - Temporary directory owning the output files
 * @param command - Native executable
 * @param args - Exact native arguments
 * @param input - Whether the child's standard input is ignored or a pipe the test writes to
 * @returns Live child and its output observations
 */
export function spawnObserved(
  base: string,
  command: string,
  args: readonly string[],
  input: "ignore" | "pipe" = "ignore",
): { readonly child: ChildProcess; readonly stdout: Observed; readonly stderr: Observed } {
  const stem = join(base, `child-${children.length}`);
  const [out, err] = [openSync(`${stem}.out`, "w"), openSync(`${stem}.err`, "w")];
  const child = spawn(command, [...args], { stdio: [input, out, err] });
  closeSync(out);
  closeSync(err);
  children.push(child);
  return { child, stdout: new Observed(`${stem}.out`), stderr: new Observed(`${stem}.err`) };
}

/** Actual native process startup observed through its own machine protocol
 * @param base - Temporary directory owning the output files
 * @param command - Native executable
 * @param args - Exact native arguments
 * @returns Live child and its first port observation
 * @throws Error when the process exits before reporting a port
 */
export async function start(base: string, command: string, args: readonly string[]): Promise<Peer> {
  const { child, stdout, stderr } = spawnObserved(base, command, args);
  const listening = stdout.find((line) => field(line.json, "port") !== undefined);
  listening.catch(() => undefined);
  const early = exited(child).then((): never => {
    throw new Error(
      `native process exited before readiness: ${stderr.lines.map((line) => line.raw).join("\n")}`,
    );
  });
  early.catch(() => undefined);
  const port = field((await Promise.race([listening, early])).json, "port");
  if (typeof port !== "number") throw new Error("native readiness protocol");
  return { child, origin: `http://127.0.0.1:${port}`, stdout, stderr };
}

/** Termination of every child started by the current test file */
export async function stopChildren(): Promise<void> {
  for (const child of children)
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await exited(child);
    }
}

/** Native raw HTTP fault peer startup
 * @param base - Temporary directory owning the output files
 * @param response - Independently authored wire bytes
 * @param stall - Hold the connection open without answering
 * @returns Actual peer with request observations
 */
export function peer(base: string, response: Buffer, stall = false): Promise<Peer> {
  return start(base, process.execPath, [
    resolve(repository, "tests/fixtures/rust/http-peer.mjs"),
    JSON.stringify({ response: response.toString("base64"), stall }),
  ]);
}

/** Complete HTTP request received by a raw peer
 * @param observed - Running peer
 * @returns Request head and exact body bytes
 */
export async function received(
  observed: Peer,
): Promise<{ readonly head: string[]; readonly body: Buffer }> {
  const line = await observed.stdout.find(
    (candidate) => field(candidate.json, "request") !== undefined,
  );
  const bytes = Buffer.from(String(field(line.json, "request")), "base64");
  const boundary = bytes.indexOf("\r\n\r\n");
  return {
    head: bytes.subarray(0, boundary).toString("latin1").split("\r\n"),
    body: bytes.subarray(boundary + 4),
  };
}

/** Header value from a received request head
 * @param head - Request line and header lines
 * @param name - Case-insensitive header name
 * @returns Header value when present
 */
export function header(head: readonly string[], name: string): string | undefined {
  return head
    .slice(1)
    .flatMap((line) =>
      line.toLowerCase().startsWith(`${name.toLowerCase()}:`)
        ? [line.slice(name.length + 1).trim()]
        : [],
    )[0];
}

/** Free loopback port that nothing listens on
 * @returns Origin refusing connections
 */
export async function closedOrigin(): Promise<string> {
  const server = createServer();
  await new Promise<void>((listening) => {
    server.listen(0, "127.0.0.1", listening);
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((closed) => {
    server.close(() => {
      closed();
    });
  });
  return `http://127.0.0.1:${port}`;
}

/** Independently authored HTTP response bytes
 * @param status - Exact status line code
 * @param headers - Header lines
 * @param body - Body bytes
 * @param length - Declared length, a longer value than the body models interruption
 * @returns Raw response
 */
export function respond(
  status: number,
  headers: Readonly<Record<string, string>>,
  body: string | Buffer = "",
  length = Buffer.byteLength(body),
): Buffer {
  const head = Object.entries(headers)
    .map(([name, value]) => `${name}: ${value}\r\n`)
    .join("");
  return Buffer.concat([
    Buffer.from(
      `HTTP/1.1 ${status} Fixture\r\n${head}Content-Length: ${length}\r\nConnection: close\r\n\r\n`,
    ),
    Buffer.from(body),
  ]);
}
