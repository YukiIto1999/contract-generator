import { spawnSync } from "node:child_process";
import type { Native } from "./native.js";
import { spawnObserved, start, type Observed, type Peer } from "./protocol.js";

/** Actual driver process over one explicit command line
 * @param native - Built fixture
 * @param line - Raw JSON-line call command preserving exact numeric tokens
 * @returns Raw stdout and stderr
 * @throws Error when the driver ends abnormally
 */
export function drive(
  native: Native,
  line: string,
): { readonly stdout: string; readonly stderr: string } {
  const result = spawnSync(native.driver, ["call"], {
    cwd: native.root,
    encoding: "utf8",
    input: `${line}\n`,
    timeout: 60_000,
  });
  if (result.status !== 0)
    throw new Error(
      `call driver ended with ${result.status} (${result.signal}) for ${line.slice(0, 300)}: ${result.stderr.slice(-2000)}`,
    );
  return { stdout: result.stdout, stderr: result.stderr };
}

/** Actual operation-driver observation
 * @param native - Built fixture
 * @param request - Explicit fixture call inputs
 * @returns Generated operation classification
 */
export function call(
  native: Native,
  request: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return JSON.parse(drive(native, JSON.stringify(request)).stdout) as Record<string, unknown>;
}

/** Driver call in flight whose host cancellation the test raises after an observed event */
export interface RunningCall {
  /** Standard error of the driver, carrying the provider-side acceptance records of the call */
  readonly stderr: Observed;
  /** Raise the host cancellation of the call */
  cancel(): void;
  /** Wait for the finished call
   * @returns Generated operation classification
   */
  result(): Promise<Record<string, unknown>>;
}

/** Actual operation-driver call that keeps running while the test observes its peer
 * @param native - Built fixture
 * @param request - Explicit fixture call inputs
 * @returns Running call
 * @throws Error when the driver has no standard input pipe
 */
export function begin(native: Native, request: Readonly<Record<string, unknown>>): RunningCall {
  const { child, stdout, stderr } = spawnObserved(native.base, native.driver, ["call"], "pipe");
  const stdin = child.stdin;
  if (stdin === null) throw new Error("call driver standard input is not a pipe");
  stdin.write(`${JSON.stringify(request)}\n`);
  return {
    stderr,
    cancel: () => {
      stdin.write('{"cancel":true}\n');
    },
    result: async () => {
      const line = await stdout.find(
        (candidate) => typeof candidate.json === "object" && candidate.json !== null,
      );
      stdin.end();
      return line.json as Record<string, unknown>;
    },
  };
}

/** Actual host-handler observations without a second validation implementation
 * @param native - Built fixture
 * @param line - Raw JSON call command
 * @returns Adapter acceptance lines from stderr, retaining exact numeric spelling
 */
export function acceptedInputs(native: Native, line: string): string[] {
  return drive(native, line)
    .stderr.split("\n")
    .filter((text) => text.startsWith("{"));
}

/** Actual codec-driver observation
 * @param native - Built fixture
 * @param type - Generated canonical type name
 * @param payload - Exact JSON token stream
 * @param binding - Selected wire interpretation
 * @returns Public codec observation
 * @throws Error when the driver ends abnormally
 */
export function decode(
  native: Native,
  type: string,
  payload: string,
  binding: "http" | "ipc" = "ipc",
): Record<string, unknown> {
  const result = spawnSync(native.codec, [], {
    cwd: native.root,
    encoding: "utf8",
    input: `${JSON.stringify({ type, payload, binding })}\n`,
    timeout: 60_000,
  });
  if (result.status !== 0)
    throw new Error(
      `codec driver ended with ${result.status} (${result.signal}): ${result.stderr.slice(-2000)}`,
    );
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

/** Real generated HTTP provider with an explicit adapter reply
 * @param native - Built fixture
 * @param reply - Raw JSON reply configuration
 * @returns Running provider
 */
export function provider(native: Native, reply: string): Promise<Peer> {
  return start(native.base, native.driver, ["http-provider", reply]);
}

/** Lines written by a separately spawned IPC provider for the given command lines
 * @param native - Built fixture
 * @param reply - Raw JSON adapter reply configuration
 * @param commands - Raw JSON command lines
 * @returns Parsed result lines of the generated IPC dispatcher
 */
export function ipcLines(
  native: Native,
  reply: string,
  commands: readonly string[],
): Record<string, unknown>[] {
  const result = spawnSync(native.driver, ["ipc-provider", reply], {
    cwd: native.root,
    encoding: "utf8",
    input: `${commands.join("\n")}\n`,
    timeout: 60_000,
  });
  return result.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}
