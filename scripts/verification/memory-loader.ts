import { pathToFileURL } from "node:url";

/** Module source format served to a Small worker */
export type ModuleFormat = "module" | "commonjs" | "json";

/** Resolution kind distinguishing `import` from `require` */
export type ResolutionKind = "import" | "require";

/** Worker runtime modules and resolutions fixed by the parent before execution */
export interface RunnerSnapshot {
  /** Module format and source by file URL */
  readonly modules: Readonly<
    Record<string, { readonly format: ModuleFormat; readonly source: string }>
  >;
  /** Resolved file URL by {@link resolutionKey} */
  readonly resolutions: Readonly<Record<string, string>>;
}

/** Nonexistent worker entry path, so the entry read that Node grants reaches no file */
export const virtualEntry = "/nonexistent/contract-generator-small-worker/worker.mjs";

/** Snapshot key of one resolution request
 * @param parentURL - Importing module, or empty for the process entry
 * @param kind - Import or require resolution
 * @param specifier - Literal specifier
 * @returns Collision-free key shared by the builder and the loader
 */
export function resolutionKey(parentURL: string, kind: ResolutionKind, specifier: string): string {
  return JSON.stringify([parentURL, kind, specifier]);
}

/** Resolution of the virtual process entry to the runner entry module
 * @param entryURL - Real runner entry module in the snapshot
 * @returns Snapshot resolution entry for the virtual path
 */
export function entryResolution(entryURL: string): Record<string, string> {
  return { [resolutionKey("", "import", pathToFileURL(virtualEntry).href)]: entryURL };
}

/** Preloader that serves every non-builtin module from the snapshot read from standard input */
const loaderSource = `
import { readFileSync } from "node:fs";
import { isBuiltin, registerHooks } from "node:module";
const snapshot = JSON.parse(readFileSync(0, "utf8"));
const missing = (message) => Object.assign(new Error(message), { code: "ERR_MODULE_NOT_FOUND" });
const native = (value) => isBuiltin(value) || value.startsWith("node:") || value.startsWith("data:");
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (native(specifier)) return nextResolve(specifier, context);
    const kind = context.conditions?.includes("require") ? "require" : "import";
    const key = JSON.stringify([context.parentURL ?? "", kind, specifier]);
    const url = snapshot.resolutions[key] ?? (Object.hasOwn(snapshot.modules, specifier) ? specifier : undefined);
    if (url === undefined) throw missing("Small worker snapshot has no " + kind + " resolution of " + specifier + " from " + context.parentURL);
    return { url, format: snapshot.modules[url].format, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    if (native(url)) return nextLoad(url, context);
    if (!Object.hasOwn(snapshot.modules, url)) throw missing("Small worker snapshot has no module " + url);
    const entry = snapshot.modules[url];
    return { format: entry.format, source: entry.source, shortCircuit: true };
  },
});
`;

/** Node arguments of a Small worker that can read no path
 * @returns Permission model without any read grant and the in-memory module loader
 */
export function memoryWorkerArguments(): string[] {
  return ["--permission", `--import=data:text/javascript,${encodeURIComponent(loaderSource)}`];
}
