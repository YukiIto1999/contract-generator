import { once } from "node:events";
import filesystem from "node:fs/promises";
import { registerHooks, syncBuiltinESMExports } from "node:module";
import { basename, dirname } from "node:path";
import { promisify } from "node:util";
import type {
  PublicationProcessMessage,
  PublicationProcessOptions,
} from "./publication-process-protocol.js";

/** Trusted test inputs passed by the spawning test process */
const options = JSON.parse(process.argv[2] ?? "null") as PublicationProcessOptions;
/** Source directory whose emitted-style imports need native TypeScript resolution */
const source = new URL("../../../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      context.parentURL?.startsWith(source.href) &&
      specifier.startsWith(".") &&
      specifier.endsWith(".js")
    )
      return nextResolve(new URL(specifier.slice(0, -3) + ".ts", context.parentURL).href, context);
    return nextResolve(specifier, context);
  },
});

/** IPC notification with delivery completed before further filesystem work
 * @param message - Observed barrier or publication completion
 * @returns Completion of the notification delivery
 * @throws {@link Error} Unavailable or failed IPC delivery
 */
async function notify(message: PublicationProcessMessage): Promise<void> {
  const send = process.send?.bind(process);
  if (send === undefined) throw new Error("Publication test process requires IPC");
  await promisify((done: (error: Error | null) => void) =>
    send(message, undefined, undefined, done),
  )();
}

/** Single pause per process despite repeated destination reads */
let barrierReached = false;

/** Parent-controlled barrier without sleeps or filesystem polling
 * @param path - Filesystem entry reached by the real operation
 * @returns Completion after the parent explicitly releases the barrier
 * @throws {@link Error} Injected operating-system refusal requested by the parent
 */
async function pause(path: string): Promise<void> {
  if (barrierReached) return;
  barrierReached = true;
  const resumed = once(process, "message");
  await notify({ kind: "paused", path });
  const [command] = await resumed;
  if (command === "fail")
    throw Object.assign(new Error("Publication barrier refused before the filesystem operation"), {
      code: "EACCES",
    });
}

/** Rejection of filesystem mutation attempts by an independent read-only check
 * @returns Permission for a writing publication
 * @throws {@link Error} Attempted mutation from check mode
 */
function requireWritablePublication(): void {
  if (options.check) throw new Error("Read-only publication check attempted a filesystem mutation");
}

/** Actual mkdir retained below the deterministic staging barrier */
const mkdir = filesystem.mkdir;
filesystem.mkdir = new Proxy(mkdir, {
  async apply(target, _receiver, args: Parameters<typeof mkdir>) {
    requireWritablePublication();
    const path = String(args[0]);
    if (options.barrier === "before-stage" && basename(path) === "staged") await pause(path);
    if (options.barrier === "before-reserve" && path === options.output) await pause(path);
    return target(...args);
  },
});

/** Actual rename retained on both sides of the deterministic displacement barrier */
const rename = filesystem.rename;
filesystem.rename = async (...args: Parameters<typeof rename>) => {
  requireWritablePublication();
  if (options.barrier === "before-install" && String(args[1]) === options.output)
    await pause(String(args[0]));
  const displaced = String(args[0]) === options.output && basename(String(args[1])) === "previous";
  if (displaced && options.barrier === "before-displace") await pause(dirname(String(args[1])));
  await rename(...args);
  if (displaced && options.barrier === "after-displace") await pause(dirname(String(args[1])));
};

/** Actual directory read retained below the check-mode inspection barrier */
const readdir = filesystem.readdir;
filesystem.readdir = new Proxy(readdir, {
  async apply(target, _receiver, args: Parameters<typeof readdir>) {
    const entries = await target(...args);
    if (options.barrier === "during-check" && String(args[0]) === options.output)
      await pause(options.output);
    return entries;
  },
});

syncBuiltinESMExports();

try {
  // Static imports run before the filesystem barriers required by this module-loading test
  const { publishOutput } = await import("../../../src/publication/publish-output.ts");
  const result = await publishOutput(options.output, options.files, options.check);
  await notify(
    result.isOk()
      ? { kind: "published", receipt: result.value }
      : { kind: "refused", failure: result.error },
  );
} catch (error) {
  await notify({
    kind: "defect",
    message: error instanceof Error ? error.message : String(error),
    code: error instanceof Error && "code" in error ? error.code : undefined,
  });
} finally {
  process.disconnect();
}
