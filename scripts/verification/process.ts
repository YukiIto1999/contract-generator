import { spawn } from "node:child_process";
import { once } from "node:events";
import { readdirSync, readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";

/** Child process outcome */
export interface CommandOutcome {
  /** Elapsed seconds until the direct child closed and its owned group terminated */
  readonly seconds: number;
  /** Exit status or no status after a signal */
  readonly status: number | null;
  /** Terminating signal or no signal after a normal exit */
  readonly signal: NodeJS.Signals | null;
}

/** Signal delivery to an owned process group
 * @param pid - Owned process group leader
 * @param signal - Cancellation or existence probe
 * @returns Whether any member of the group received the signal
 * @throws {@link Error} Signal delivery failure other than an absent group
 */
function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw error;
  }
}

/** Executable members of an owned group after the direct child closes
 * @param group - Owned process group
 * @returns Presence of a member that has not reached a terminated kernel state
 */
function groupHasLiveMembers(group: number): boolean {
  return readdirSync("/proc").some((entry) => {
    if (!/^\d+$/.test(entry)) return false;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return Number(fields[2]) === group && fields[0] !== "Z" && fields[0] !== "X";
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ESRCH")
      )
        return false;
      throw error;
    }
  });
}

/** Resource ceiling for orderly process-group shutdown */
const shutdownMilliseconds = 2_000;

/** Observed group termination without mistaking an exit or reaping race for live work
 * @param group - Owned process group
 * @param deadline - Absolute monotonic shutdown deadline
 * @returns Whether every observed member terminated before the deadline
 */
async function drainGroup(group: number, deadline: number): Promise<boolean> {
  while (signalGroup(group, 0) && groupHasLiveMembers(group)) {
    const remaining = deadline - performance.now();
    if (!(remaining > 0)) return false;
    await delay(Math.min(10, remaining));
  }
  return true;
}

/** Owned group cancellation with observed termination after escalation
 * @param group - Owned process group
 * @throws {@link Error} Live descendants remaining after forced shutdown
 */
async function terminateGroup(group: number): Promise<void> {
  signalGroup(group, "SIGTERM");
  if (await drainGroup(group, performance.now() + shutdownMilliseconds)) return;
  signalGroup(group, "SIGKILL");
  if (!(await drainGroup(group, performance.now() + shutdownMilliseconds)))
    throw new Error(`Verification process group ${group} did not terminate after SIGKILL`);
}

/** Bounded execution with cancellation of every owned descendant
 * @param command - Executable and literal arguments
 * @param env - Explicit non-secret execution environment
 * @param milliseconds - Remaining whole-tier resource budget
 * @returns Reaped direct-child outcome
 * @throws {@link Error} Cancellation or incomplete process-group shutdown
 */
export async function runCommand(
  command: readonly string[],
  env: NodeJS.ProcessEnv,
  milliseconds: number,
): Promise<CommandOutcome> {
  if (!(milliseconds > 0)) throw new Error("Whole-tier verification budget exhausted");
  const started = performance.now();
  const child = spawn(command[0]!, command.slice(1), { env, stdio: "inherit", detached: true });
  if (child.pid === undefined) {
    await once(child, "close");
    throw new Error(`Unable to start ${command[0]}`);
  }
  const pid = child.pid;
  let cancellation: Promise<void> | undefined;
  const cancel = (): Promise<void> => {
    cancellation ??= terminateGroup(pid);
    return cancellation;
  };
  const timeout = setTimeout(cancel, milliseconds);
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const [status, signal] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
    const drained = await drainGroup(
      pid,
      Math.min(started + milliseconds, performance.now() + shutdownMilliseconds),
    );
    if (cancellation !== undefined) {
      await cancellation;
      throw new Error(
        `Verification interrupted or exceeded its whole-tier budget: ${command.join(" ")}`,
      );
    }
    if (!drained) {
      await cancel();
      throw new Error(`Verification left running descendants: ${command.join(" ")}`);
    }
    return { seconds: (performance.now() - started) / 1_000, status, signal };
  } finally {
    clearTimeout(timeout);
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
    if (cancellation !== undefined) await cancellation;
  }
}
