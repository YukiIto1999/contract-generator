import assert from "node:assert/strict";
import { spawn } from "node:child_process";

/** Execution options of one owned subprocess */
export interface Execution {
  /** Owning working directory */
  readonly cwd: string;
  /** Explicit subprocess environment */
  readonly env: NodeJS.ProcessEnv;
  /** Finite safety bound in milliseconds */
  readonly limit: number;
}

/** Forced termination of a process group created by this runner
 * @param pid - Leader of the owned process group
 * @throws {@link Error} Failure other than an already finished group
 */
function killGroup(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (failure) {
    if (!(failure instanceof Error) || !("code" in failure) || failure.code !== "ESRCH")
      throw failure;
  }
}

/** Subprocess in its own process group with distinct streams and the actual termination
 * @param command - Required installed executable
 * @param args - Exact subprocess arguments
 * @param execution - Working directory, environment and safety bound
 * @returns Standard output of a subprocess that exited 0 without a signal
 * @throws {@link Error} Missing prerequisite, nonzero exit, signal, timeout or interruption of this runner
 */
export async function run(
  command: string,
  args: readonly string[],
  execution: Execution,
): Promise<string> {
  const child = spawn(command, [...args], {
    cwd: execution.cwd,
    env: execution.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", (text: string) => {
    stdout += text;
    process.stdout.write(text);
  });
  child.stderr.on("data", (bytes: Buffer) => process.stderr.write(bytes));
  let interruption: string | undefined;
  const stop = (reason: string) => {
    interruption ??= reason;
    if (child.pid !== undefined) killGroup(child.pid);
  };
  const timer = setTimeout(() => stop(`exceeded ${execution.limit} ms`), execution.limit);
  const onInterrupt = () => stop("runner interrupted by SIGINT");
  const onTerminate = () => stop("runner terminated by SIGTERM");
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onTerminate);
  // Promise.withResolvers is outside the ES2023 library that the repository typechecks against.
  const closed = new Promise<[number | null, NodeJS.Signals | null]>((done, refuse) => {
    child.once("error", refuse);
    child.once("close", (code, signal) => done([code, signal]));
  });
  try {
    const [code, signal] = await closed;
    const reason = interruption === undefined ? "" : `: ${interruption}`;
    assert.ok(
      interruption === undefined && code === 0 && signal === null,
      `${command} ended with ${code} (${signal})${reason}`,
    );
    return stdout;
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", onInterrupt);
    process.removeListener("SIGTERM", onTerminate);
    stop("completed");
  }
}
