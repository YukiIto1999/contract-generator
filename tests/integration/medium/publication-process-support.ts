import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { on, once } from "node:events";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect } from "vite-plus/test";
import type { GeneratedFile } from "../../../src/model/contract-model.js";
import type {
  PublicationProcessMessage,
  PublicationProcessOptions,
  PublicationProcessOutcome,
} from "./publication-process-protocol.js";

/** Independent publisher with observable process exit and an optional filesystem barrier */
export interface PublicationProcess {
  /** Child process controlled by the test */
  readonly child: ChildProcess;
  /** Filesystem location reached by a requested barrier */
  readonly paused: Promise<string> | undefined;
  /** Typed completion after process exit */
  readonly completed: Promise<PublicationProcessOutcome>;
  /** Process close after all standard streams have closed */
  readonly closed: Promise<unknown[]>;
}

/** One trusted IPC message with unexpected process exit reported as a test defect
 * @param messages - Buffered IPC events of the child
 * @returns Barrier or completion emitted by the independent publisher
 * @throws {@link Error} Process exit before the expected notification
 */
async function receive(messages: AsyncIterator<unknown[]>): Promise<PublicationProcessMessage> {
  const received = await messages.next();
  if (received.done) throw new Error("Publication process exited without its expected IPC message");
  return received.value[0] as PublicationProcessMessage;
}

/** Completion after the optional barrier and actual process close
 * @param messages - Buffered IPC events of the child
 * @param first - Initial notification already shared with the barrier observer
 * @param closed - Process close notification
 * @returns Publication outcome after the child has exited
 * @throws {@link Error} Unexpected additional barrier or missing completion
 */
async function completion(
  messages: AsyncIterator<unknown[]>,
  first: Promise<PublicationProcessMessage>,
  closed: Promise<unknown[]>,
): Promise<PublicationProcessOutcome> {
  const initial = await first;
  const result = initial.kind === "paused" ? await receive(messages) : initial;
  await closed;
  if (result.kind === "paused")
    throw new Error("Publication process reached an unexpected barrier");
  return result;
}

/** Per-test child lifecycle with all publishers killed and drained after failures
 * @returns Launcher of isolated publication processes
 */
export function usePublicationProcesses(): (
  options: PublicationProcessOptions,
) => PublicationProcess {
  const children: PublicationProcess[] = [];
  afterEach(async () => {
    for (const publisher of children)
      if (publisher.child.exitCode === null && publisher.child.signalCode === null)
        publisher.child.kill("SIGKILL");
    await Promise.all(children.map((publisher) => publisher.closed));
    children.length = 0;
  });
  return (options) => {
    const child = fork(
      new URL("./publication-process.ts", import.meta.url),
      [JSON.stringify(options)],
      {
        execArgv: [],
        stdio: ["ignore", "inherit", "inherit", "ipc"],
      },
    );
    const closed = once(child, "close");
    const messages = on(child, "message", { close: ["close"] });
    const first = receive(messages);
    const completed = completion(messages, first, closed);
    const paused =
      options.barrier === undefined
        ? undefined
        : first.then((message) => {
            if (message.kind !== "paused")
              throw new Error("Publisher completed before its requested barrier");
            return message.path;
          });
    const publisher = { child, closed, completed, paused };
    void completed.catch(() => undefined);
    children.push(publisher);
    return publisher;
  };
}

/** Whole published tree with an independently checked artifact manifest
 * @param output - Published destination
 * @param files - Literal artifact expectations independent of publication helpers
 * @returns Completion after every artifact and manifest identity matches
 */
export async function expectPublishedTree(
  output: string,
  files: readonly GeneratedFile[],
): Promise<void> {
  const identities = [];
  for (const path of files.map((file) => file.path).sort()) {
    const expected = files.find((file) => file.path === path);
    const bytes = await readFile(join(output, path));
    expect(bytes.toString("utf8")).toBe(expected?.content);
    identities.push({ path, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  const marker: unknown = JSON.parse(
    await readFile(join(output, ".contract-generator.json"), "utf8"),
  );
  expect(marker).toEqual({
    generator: "@yukiito1999/contract-generator",
    format: 1,
    files: identities,
  });
  const actual = (await readdir(output, { recursive: true, withFileTypes: true }))
    .filter((entry) => !entry.isDirectory())
    .map((entry) => join(entry.parentPath, entry.name).slice(output.length + 1))
    .sort();
  expect(actual).toEqual([".contract-generator.json", ...files.map((file) => file.path)].sort());
}
