import { fork, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { join } from "node:path";
import type { PoolOptions, PoolWorker, WorkerRequest } from "vite-plus/test/node";
import { memoryWorkerArguments, virtualEntry } from "./memory-loader.ts";
import { selectedSuites } from "./suites.ts";

/** Upper bound of the serialized worker runtime snapshot */
const snapshotBytes = 1 << 28;

/** Runner packages that Vitest imports natively for test modules instead of inlining them */
const externalizedRunner = ["vitest"];

/** Serialized runner snapshots by Vitest distribution directory, built once per run */
const snapshots = new Map<string, string>();

/** Worker runtime snapshot built by Node's resolver in a separate parent-side process
 * @param distPath - Vitest distribution directory containing the fork worker entry
 * @returns Serialized snapshot delivered to every Small worker
 * @throws {@link Error} Builder failure, which leaves no Small worker started
 */
function serializedSnapshot(distPath: string): string {
  const cached = snapshots.get(distPath);
  if (cached !== undefined) return cached;
  const builder = join(process.cwd(), "scripts/verification/runner-snapshot.ts");
  const entry = join(distPath, "workers/forks.js");
  const built = spawnSync(
    process.execPath,
    [
      "--experimental-import-meta-resolve",
      builder,
      entry,
      ...externalizedRunner,
      "--sources",
      ...selectedSuites("small"),
    ],
    {
      encoding: "utf8",
      maxBuffer: snapshotBytes,
    },
  );
  if (built.error !== undefined || built.status !== 0)
    throw new Error(
      `Small worker snapshot failed for ${entry}: ${built.error?.message ?? built.stderr}`,
    );
  snapshots.set(distPath, built.stdout);
  return built.stdout;
}

/** Vitest fork worker whose process can read no path and loads its runtime from the snapshot */
class SmallPoolWorker implements PoolWorker {
  /** Pool name reported to Vitest */
  readonly name = "small";
  /** Transformed modules travel over IPC because the worker cannot read cache files */
  readonly cacheFs = false;
  /** Started worker process */
  private child: ChildProcess | undefined;
  /** Pool options supplied by Vitest for this worker */
  private readonly options: PoolOptions;

  /** Worker bound to one Vitest pool request
   * @param options - Distribution path, environment and arguments of the worker
   */
  constructor(options: PoolOptions) {
    this.options = options;
  }

  /** Started worker process
   * @returns Running child
   * @throws {@link Error} Worker used before start or after stop
   */
  private get process(): ChildProcess {
    if (this.child === undefined) throw new Error("The Small worker is not running");
    return this.child;
  }

  /** Subscription to worker process events
   * @param event - Child process event name
   * @param callback - Vitest event handler
   */
  on(event: string, callback: (...args: unknown[]) => void): void {
    this.process.on(event, callback);
  }

  /** Removal of a worker process event subscription, which also follows a failed start
   * @param event - Child process event name
   * @param callback - Previously subscribed handler
   */
  off(event: string, callback: (...args: unknown[]) => void): void {
    this.child?.off(event, callback);
  }

  /** Vitest request delivery over the worker IPC channel
   * @param message - Vitest worker request
   */
  send(message: WorkerRequest): void {
    this.process.send(message);
  }

  /** IPC payload that advanced serialization already decoded
   * @param data - Received worker message
   * @returns Unchanged message
   */
  deserialize(data: unknown): unknown {
    return data;
  }

  /** Worker start with the runner snapshot delivered before any test module loads */
  async start(): Promise<void> {
    const snapshot = serializedSnapshot(this.options.distPath);
    const child = fork(virtualEntry, [], {
      env: this.options.env,
      execArgv: [...memoryWorkerArguments(), ...this.options.execArgv],
      stdio: ["pipe", "inherit", "inherit", "ipc"],
      serialization: "advanced",
    });
    this.child = child;
    // Broken-pipe rethrow rejected because Vitest already fails the run on the resulting worker exit
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(snapshot);
  }

  /** Worker termination awaiting process exit, which also follows a failed start */
  async stop(): Promise<void> {
    const child = this.child;
    if (child === undefined) return;
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    this.child = undefined;
  }
}

/** Vitest pool that runs Small test files in filesystem-denied workers */
export const smallPool = {
  name: "small",
  createPoolWorker: (options: PoolOptions): PoolWorker => new SmallPoolWorker(options),
};
