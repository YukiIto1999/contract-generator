import { fork } from "node:child_process";
import { once } from "node:events";
import { connect, createServer, type Socket } from "node:net";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  entryResolution,
  memoryWorkerArguments,
  virtualEntry,
  type RunnerSnapshot,
} from "./memory-loader.ts";

/** RFC 5737 documentation address that no local service owns */
const externalAddress = "192.0.2.1";
/** Observation ceiling for a TCP attempt in an isolated namespace */
const attemptMilliseconds = 2_000;
/** Resource uses that a Small worker must find denied */
const deniedResources = [
  "repositoryRead",
  "runnerRead",
  "dependencyRead",
  "temporaryWrite",
  "childProcess",
  "workerThread",
  "internalBinding",
];

/** Restricted worker body served from memory exactly as the Small pool serves the runner */
const workerSource = `
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { Worker } from "node:worker_threads";
const attempt = (operation) => {
  try {
    const failure = operation()?.error;
    return failure === undefined ? "allowed" : failure.code ?? String(failure);
  } catch (error) {
    return error?.code ?? String(error);
  }
};
const paths = JSON.parse(process.argv[2]);
process.send({
  repositoryRead: attempt(() => readFileSync(paths.repository)),
  runnerRead: attempt(() => readFileSync(paths.runner)),
  dependencyRead: attempt(() => readFileSync(paths.dependency)),
  temporaryWrite: attempt(() => writeFileSync(tmpdir() + "/contract-small-" + process.pid, "")),
  childProcess: attempt(() => spawnSync(process.execPath, ["--version"])),
  workerThread: attempt(() => new Worker("0", { eval: true }).terminate()),
  internalBinding: attempt(() => process.binding("fs")),
}, () => process.exit(0));
`;

/** Error code of an observed operation
 * @param error - Thrown or emitted failure
 * @returns Node error code or message
 */
function codeOf(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return error instanceof Error ? error.message : String(error);
}

/** Outcome of one TCP connection attempt
 * @param host - Literal IP address
 * @param port - TCP port
 * @returns `connected`, `timeout` or the connection error code
 */
async function connection(host: string, port: number): Promise<string> {
  const socket = connect({ host, port });
  try {
    await once(socket, "connect", { signal: AbortSignal.timeout(attemptMilliseconds) });
    return "connected";
  } catch (error) {
    return error instanceof Error && error.name === "AbortError" ? "timeout" : codeOf(error);
  } finally {
    socket.destroy();
  }
}

/** Loopback reachability from this process
 * @returns Connection outcome to an owned loopback listener
 */
async function loopback(): Promise<string> {
  const server = createServer((socket: Socket) => socket.destroy());
  server.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
  } catch (error) {
    return `listen ${codeOf(error)}`;
  }
  const address = server.address();
  try {
    if (address === null || typeof address === "string") return `listen address ${String(address)}`;
    return await connection("127.0.0.1", address.port);
  } finally {
    server.close();
  }
}

/** Observations of a worker started with the exact Small pool arguments and loader
 * @returns Outcome of each resource use attempted by the worker
 */
async function smallWorker(): Promise<Record<string, unknown>> {
  const entryURL = pathToFileURL(virtualEntry).href;
  const snapshot: RunnerSnapshot = {
    modules: { [entryURL]: { format: "module", source: workerSource } },
    resolutions: entryResolution(entryURL),
  };
  const paths = {
    repository: join(process.cwd(), "package.json"),
    runner: join(process.cwd(), "node_modules/vitest/package.json"),
    dependency: join(process.cwd(), "node_modules/typescript/package.json"),
  };
  const child = fork(virtualEntry, [JSON.stringify(paths)], {
    execArgv: memoryWorkerArguments(),
    stdio: ["pipe", "inherit", "inherit", "ipc"],
  });
  child.stdin?.end(JSON.stringify(snapshot));
  const [message] = await once(child, "message");
  await once(child, "exit");
  return typeof message === "object" && message !== null ? { ...message } : { message };
}

/** Runner isolation observations and their violations
 * @param size - Requested runner size
 * @returns Observations and every mismatch against the size contract
 */
async function observe(size: string): Promise<{ observed: unknown; failures: string[] }> {
  const external = await connection(externalAddress, 9);
  const local = await loopback();
  const failures: string[] = [];
  if (external !== "ENETUNREACH")
    failures.push(`external ${externalAddress}: ${external}; expected ENETUNREACH`);
  if (size === "medium" && local !== "connected")
    failures.push(`loopback: ${local}; expected connected`);
  if (size === "small" && local !== "ENETUNREACH")
    failures.push(`loopback: ${local}; expected ENETUNREACH`);
  const worker = size === "small" ? await smallWorker() : {};
  if (size === "small")
    for (const name of deniedResources)
      if (worker[name] !== "ERR_ACCESS_DENIED")
        failures.push(`small worker ${name}: ${String(worker[name])}; expected ERR_ACCESS_DENIED`);
  return { observed: { size, external, loopback: local, worker }, failures };
}

const mode = process.argv[2];
if (mode === "small" || mode === "medium") {
  const { observed, failures } = await observe(mode);
  console.log(JSON.stringify({ event: "sandbox", observed, failures }));
  if (failures.length > 0) process.exitCode = 1;
} else {
  console.error(`Expected sandbox size small or medium; received ${mode ?? "nothing"}`);
  process.exitCode = 2;
}
